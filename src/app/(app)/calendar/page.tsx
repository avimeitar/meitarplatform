import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { meetingClient } from "@/lib/crm/constants";
import { addDays, dayLabel, iso, MON, monthStart, sod, WD, weekStart } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { can, requirePageUser, type CurrentUser } from "@/lib/session";
import { CalendarFilters } from "../meetings/CalendarFilters";
import { canEditMeeting, filterWhere, include, meetingsContext, NOT_ON_CALENDAR, parseDay, type MeetingsContext, type Params } from "../meetings/common";
import { MeetingsCalendar, type CalMeeting } from "../meetings/MeetingsCalendar";

export const metadata = { title: "יומן פגישות" };

type Mode = "day" | "week" | "month";

/** "8–13 בנובמבר 2026", "29 בנובמבר – 4 בדצמבר 2026" */
function rangeLabel(a: Date, b: Date): string {
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ב${MON[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()} ב${MON[a.getMonth()]} – ${b.getDate()} ב${MON[b.getMonth()]} ${b.getFullYear()}`;
}

/** The meetings calendar, for viewing: day, week or month. Meetings are booked and updated on the meetings screen. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const ctx = await meetingsContext(u, sp);
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>יומן פגישות</h1>
          <p className="sub">כל הפגישות ביומן, לצפייה. קובעים פגישה חדשה ומעדכנים מה קרה במסך פגישות.</p>
        </div>
        <div className="head-actions">
          <Link className="btn ghost" href="/meetings">
            <Icon name="list" />
            למסך הפגישות
          </Link>
        </div>
      </div>
      <CalendarView u={u} sp={sp} ctx={ctx} now={new Date()} />
    </section>
  );
}

async function CalendarView({ u, sp, ctx, now }: { u: CurrentUser; sp: Params; ctx: MeetingsContext; now: Date }) {
  const { who, scope, mineWhere, filters, options } = ctx;
  const mode: Mode = sp.mode === "day" || sp.mode === "month" ? sp.mode : "week";
  const today = sod(now);
  // on Saturday the calendar opens on the coming week
  const home = today.getDay() === 6 ? addDays(today, 1) : today;
  const anchor = parseDay(sp.date) ?? home;
  let start: Date;
  let end: Date;
  if (mode === "day") {
    start = sod(anchor);
    end = addDays(start, 1);
  } else if (mode === "week") {
    start = weekStart(anchor);
    end = addDays(start, 7);
  } else {
    const first = monthStart(anchor);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    start = weekStart(first);
    end = addDays(weekStart(last), 7);
  }
  const person = filters.person;
  const showCancelled = sp.cancelled === "1";
  const where: Prisma.MeetingWhereInput = {
    AND: [scope, who === "mine" ? mineWhere : {}, ...filterWhere(filters), showCancelled ? {} : { status: { notIn: NOT_ON_CALENDAR } }, { startAt: { gte: start, lt: end } }],
  };
  const [rows, staleCount] = await Promise.all([
    prisma.meeting.findMany({ where, orderBy: { startAt: "asc" }, take: 3000, include }),
    prisma.meeting.count({ where: { AND: [scope, who === "mine" ? mineWhere : {}, { status: "set", startAt: { lt: now } }] } }),
  ]);
  const meetings: CalMeeting[] = rows.map((m) => ({
    id: m.id,
    leadId: m.leadId,
    name: meetingClient(m),
    startAt: m.startAt.toISOString(),
    place: m.place,
    status: m.status,
    confirmed: m.confirmed,
    projectName: m.project?.name ?? "",
    subject: m.subject ?? "",
    setByName: m.setBy?.name ?? m.repName ?? null,
    hostName: m.host?.name ?? null,
    person: m.host?.name ?? m.setBy?.name ?? m.repName ?? "ללא שיוך",
    source: m.source ?? "",
    note: m.note ?? "",
    canEdit: canEditMeeting(u, m),
    phoneRaw: m.lead?.phone ?? "",
  }));

  // the days shown: a week without Saturday unless something is on it; a month as whole weeks
  let days: string[] = [];
  const count = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  for (let i = 0; i < count; i++) days.push(iso(addDays(start, i)));
  const busy = new Set(meetings.map((m) => iso(new Date(m.startAt))));
  if (mode === "week") days = days.filter((k) => parseDay(k)!.getDay() !== 6 || busy.has(k));

  // working hours, stretched to show any meeting outside them
  let startHour = 8;
  let endHour = 21;
  for (const m of rows) {
    const h = m.startAt.getHours();
    startHour = Math.min(startHour, h);
    endHour = Math.max(endHour, Math.min(24, h + 2));
  }
  const byPerson = mode === "day" && who === "all" && !person && new Set(meetings.map((m) => m.person)).size > 1;

  // links that keep the filters
  const keep = { who, ...(person ? { person } : {}), ...(filters.project ? { project: filters.project } : {}), ...(showCancelled ? { cancelled: "1" } : {}) };
  const href = (extra: Record<string, string>) => `/calendar?${new URLSearchParams({ ...keep, mode, date: iso(anchor), ...extra })}`;
  const dayHref = Object.fromEntries(days.map((k) => [k, href({ mode: "day", date: k })]));
  const step = (n: number) => {
    if (mode === "week") return iso(addDays(anchor, 7 * n));
    if (mode === "month") return iso(new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
    // day by day, skipping Saturday
    let d = addDays(anchor, n);
    if (d.getDay() === 6) d = addDays(d, n);
    return iso(d);
  };
  const label =
    mode === "day"
      ? `${dayLabel(anchor, now).includes(" ") ? "" : dayLabel(anchor, now) + ", "}${WD[anchor.getDay()]}, ${anchor.getDate()} ב${MON[anchor.getMonth()]} ${anchor.getFullYear()}`
      : mode === "week"
        ? rangeLabel(parseDay(days[0])!, parseDay(days[days.length - 1])!)
        : `${MON[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const back = mode === "day" ? (home === today ? "חזרה להיום" : "ליום העבודה הבא") : mode === "week" ? "לשבוע הנוכחי" : "לחודש הנוכחי";
  const isCurrent = mode === "day" ? iso(anchor) === iso(home) : mode === "week" ? iso(weekStart(anchor)) === iso(weekStart(home)) : anchor.getMonth() === home.getMonth() && anchor.getFullYear() === home.getFullYear();

  return (
    <>
      <div className="cal-bar">
        <div className="cal-nav">
          <Link className="ib" href={href({ date: step(-1) })} aria-label={mode === "day" ? "היום הקודם" : mode === "week" ? "השבוע הקודם" : "החודש הקודם"}>
            <Icon name="chev-r" />
          </Link>
          <Link className="ib" href={href({ date: step(1) })} aria-label={mode === "day" ? "היום הבא" : mode === "week" ? "השבוע הבא" : "החודש הבא"}>
            <Icon name="chev-l" />
          </Link>
          <h2 className="cal-title">{label}</h2>
          {!isCurrent && (
            <Link className="btn sm" href={href({ date: iso(home) })}>
              {back}
            </Link>
          )}
        </div>
        <div className="seg" role="group" aria-label="טווח">
          {(
            [
              ["day", "יום"],
              ["week", "שבוע"],
              ["month", "חודש"],
            ] as const
          ).map(([k, l]) => (
            <Link key={k} className={mode === k ? "on" : ""} href={href({ mode: k })} aria-current={mode === k ? "page" : undefined}>
              {l}
            </Link>
          ))}
        </div>
        {can(u, "leads.view_all") && (
          <div className="seg" role="group" aria-label="של מי">
            <Link className={who === "mine" ? "on" : ""} href={`/calendar?${new URLSearchParams({ ...keep, who: "mine", mode, date: iso(anchor) })}`}>
              שלי
            </Link>
            <Link className={who === "all" ? "on" : ""} href={`/calendar?${new URLSearchParams({ ...keep, who: "all", mode, date: iso(anchor) })}`}>
              כל הצוות
            </Link>
          </div>
        )}
        <CalendarFilters view="cal" people={options.people} projects={options.projects} person={person} project={filters.project} cancelled={showCancelled} />
      </div>
      {staleCount > 0 && (
        <Link className="achip amber cal-stale" href={`/meetings?${new URLSearchParams({ view: "list", range: "stale", who })}`}>
          <Icon name="alert" />
          {staleCount === 1 ? "פגישה אחת שעברה מחכה לסימון מה קרה" : `${staleCount} פגישות שעברו מחכות לסימון מה קרה`}
        </Link>
      )}
      <MeetingsCalendar
        mode={mode}
        days={days}
        month={mode === "month" ? iso(anchor).slice(0, 7) : undefined}
        todayKey={iso(today)}
        meetings={meetings}
        startHour={startHour}
        endHour={endHour}
        byPerson={byPerson}
        dayHref={dayHref}
      />
      <p className="cal-hint">
        לחיצה על פגישה מציגה את הפרטים שלה. קובעים ומעדכנים פגישות במסך <Link href="/meetings">פגישות</Link>.
        {mode === "week" && who === "all" ? " לחיצה על שם היום פותחת את היום עם עמודה לכל איש צוות." : ""}
      </p>
    </>
  );
}
