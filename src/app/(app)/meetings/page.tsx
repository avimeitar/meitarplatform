import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { meetingClient } from "@/lib/crm/constants";
import { addDays, dayLabel, iso, MON, monthStart, nextWorkday, sod, WD, weekStart } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { can, requirePageUser, type CurrentUser } from "@/lib/session";
import { CalendarFilters } from "./CalendarFilters";
import { MeetingsCalendar, type CalMeeting } from "./MeetingsCalendar";
import { MeetingsList, NewMeetingButton, type MeetingRowData } from "./MeetingsList";

export const metadata = { title: "פגישות" };

const STEP = 100;
type Params = Record<string, string | undefined>;
type Mode = "day" | "week" | "month";

const include = { lead: { select: { id: true, name: true, phone: true, ownerId: true } }, project: { select: { name: true } }, setBy: { select: { name: true } }, host: { select: { name: true } } } as const;

function parseDay(s?: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "8–13 בנובמבר 2026", "29 בנובמבר – 4 בדצמבר 2026" */
function rangeLabel(a: Date, b: Date): string {
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ב${MON[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()} ב${MON[a.getMonth()]} – ${b.getDate()} ב${MON[b.getMonth()]} ${b.getFullYear()}`;
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const manager = can(u, "reports.view");
  const now = new Date();
  const today = sod(now);
  const who = sp.who === "all" || (manager && sp.who !== "mine") ? "all" : "mine";
  const mineWhere: Prisma.MeetingWhereInput = { OR: [{ setById: u.id }, { hostId: u.id }, { lead: { ownerId: u.id } }] };
  const scope: Prisma.MeetingWhereInput = can(u, "leads.view_all") ? {} : mineWhere;
  // the calendar is the main view; the list stays for searching and for marking past meetings
  const view = sp.view === "list" || (sp.view !== "cal" && (sp.range || sp.q)) ? "list" : "cal";

  let kpis: { upcoming: number; held: number; cancel: number } | null = null;
  if (manager) {
    const since = addDays(today, -29);
    const [up, held, cancel] = await Promise.all([
      prisma.meeting.count({ where: { status: "set", startAt: { gte: now } } }),
      prisma.meeting.count({ where: { status: "held", startAt: { gte: since, lt: addDays(today, 1) } } }),
      prisma.meeting.count({ where: { status: "cancel", startAt: { gte: since, lt: addDays(today, 1) } } }),
    ]);
    kpis = { upcoming: up, held, cancel };
  }

  const viewHref = (v: "cal" | "list") => `/meetings?${new URLSearchParams({ view: v, who })}`;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>פגישות</h1>
          <p className="sub">אחרי כל פגישה מסמנים מה קרה: התקיימה או בוטלה. אם הפגישה שייכת לליד, הוא מתעדכן לבד.</p>
        </div>
        <div className="head-actions">
          <div className="seg" role="group" aria-label="תצוגה">
            <Link className={view === "cal" ? "on" : ""} href={viewHref("cal")} aria-current={view === "cal" ? "page" : undefined}>
              <Icon name="cal" />
              יומן
            </Link>
            <Link className={view === "list" ? "on" : ""} href={viewHref("list")} aria-current={view === "list" ? "page" : undefined}>
              <Icon name="list" />
              רשימה
            </Link>
          </div>
          {can(u, "leads.edit") && <NewMeetingButton />}
        </div>
      </div>
      {kpis && (
        <div className="kpis">
          <div className="kpi">
            <span>פגישות קרובות</span>
            <b>{kpis.upcoming}</b>
          </div>
          <div className="kpi">
            <span>התקיימו ב-30 יום</span>
            <b>{kpis.held}</b>
          </div>
          <div className="kpi">
            <span>בוטלו ב-30 יום</span>
            <b>{kpis.cancel}</b>
          </div>
          <div className="kpi">
            <span>אחוז הפגישות שהתקיימו</span>
            <b>{kpis.held + kpis.cancel ? Math.round((kpis.held / (kpis.held + kpis.cancel)) * 100) + "%" : "0%"}</b>
          </div>
        </div>
      )}
      {view === "cal" ? <CalendarView u={u} sp={sp} who={who} scope={scope} mineWhere={mineWhere} now={now} /> : <ListView u={u} sp={sp} who={who} scope={scope} mineWhere={mineWhere} now={now} manager={manager} />}
    </section>
  );
}

type ViewArgs = { u: CurrentUser; sp: Params; who: "all" | "mine"; scope: Prisma.MeetingWhereInput; mineWhere: Prisma.MeetingWhereInput; now: Date };

function canEditMeeting(u: CurrentUser, m: { setById: string | null; hostId: string | null; lead: { ownerId: string | null } | null }) {
  return can(u, "leads.edit") && (m.setById === u.id || m.hostId === u.id || m.lead?.ownerId === u.id || can(u, "meetings.manage_all"));
}

// ---------------------------------------------------------------- the calendar

async function CalendarView({ u, sp, who, scope, mineWhere, now }: ViewArgs) {
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
  const teamView = can(u, "leads.view_all");
  const person = teamView && sp.person ? sp.person : "";
  const showCancelled = sp.cancelled === "1";
  const where: Prisma.MeetingWhereInput = {
    AND: [
      scope,
      who === "mine" ? mineWhere : {},
      person ? { OR: [{ setById: person }, { hostId: person }] } : {},
      sp.project ? { projectId: sp.project } : {},
      showCancelled ? {} : { status: { not: "cancel" } },
      { startAt: { gte: start, lt: end } },
    ],
  };
  const [rows, staleCount, people, projects] = await Promise.all([
    prisma.meeting.findMany({ where, orderBy: { startAt: "asc" }, take: 3000, include }),
    prisma.meeting.count({ where: { AND: [scope, who === "mine" ? mineWhere : {}, { status: "set", startAt: { lt: now } }] } }),
    teamView ? prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
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
  const keep = { view: "cal", who, ...(person ? { person } : {}), ...(sp.project ? { project: sp.project } : {}), ...(showCancelled ? { cancelled: "1" } : {}) };
  const href = (extra: Record<string, string>) => `/meetings?${new URLSearchParams({ ...keep, mode, date: iso(anchor), ...extra })}`;
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
        {teamView && (
          <div className="seg" role="group" aria-label="של מי">
            <Link className={who === "mine" ? "on" : ""} href={`/meetings?${new URLSearchParams({ ...keep, who: "mine", mode, date: iso(anchor) })}`}>
              שלי
            </Link>
            <Link className={who === "all" ? "on" : ""} href={`/meetings?${new URLSearchParams({ ...keep, who: "all", mode, date: iso(anchor) })}`}>
              כל הצוות
            </Link>
          </div>
        )}
        <CalendarFilters people={people} projects={projects} person={person} project={sp.project ?? ""} cancelled={showCancelled} />
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
        canCreate={can(u, "leads.edit")}
        dayHref={dayHref}
      />
      <p className="cal-hint">
        {mode !== "month" && can(u, "leads.edit") ? "לחיצה על שעה פנויה ביומן קובעת בה פגישה. " : ""}לחיצה על פגישה מראה את כל הפרטים.
        {mode === "week" && who === "all" ? " לחיצה על שם היום פותחת את היום עם עמודה לכל איש צוות." : ""}
      </p>
    </>
  );
}

// ---------------------------------------------------------------- the list

async function ListView({ u, sp, who, scope, mineWhere, now, manager }: ViewArgs & { manager: boolean }) {
  const today = sod(now);
  const next = nextWorkday(now);
  const RANGES: [string, string, Prisma.MeetingWhereInput][] = [
    ["today", "היום", { startAt: { gte: today, lt: addDays(today, 1) } }],
    ["next", dayLabel(next, now), { startAt: { gte: next, lt: addDays(next, 1) } }],
    ...(manager ? ([["week", "השבוע", { startAt: { gte: weekStart(now), lt: addDays(weekStart(now), 7) } }]] as [string, string, Prisma.MeetingWhereInput][]) : []),
    ["upcoming", "כל הקרובות", { startAt: { gte: now } }],
    ...(manager ? ([["past", "שעברו", { startAt: { lt: now } }]] as [string, string, Prisma.MeetingWhereInput][]) : []),
    ["stale", "לסמן מה קרה", { startAt: { lt: now }, status: "set" }],
  ];
  const range = RANGES.find((r) => r[0] === sp.range) ?? RANGES.find((r) => r[0] === "upcoming")!;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const limit = Math.min(2000, Math.max(STEP, Number(sp.limit) || STEP));
  // a search looks through every meeting this person may see, at any date
  const where: Prisma.MeetingWhereInput = q
    ? { AND: [scope, { OR: [{ clientName: { contains: q, mode: "insensitive" } }, { lead: { name: { contains: q, mode: "insensitive" } } }, { subject: { contains: q, mode: "insensitive" } }] }] }
    : { AND: [scope, range[2], who === "mine" ? mineWhere : {}, sp.status ? { status: sp.status } : {}] };
  const asc = !q && range[0] !== "past";
  const [rows, total] = await Promise.all([prisma.meeting.findMany({ where, orderBy: { startAt: asc ? "asc" : "desc" }, take: limit, include }), prisma.meeting.count({ where })]);
  const data: MeetingRowData[] = rows.map((m) => ({
    id: m.id,
    leadId: m.leadId,
    leadName: meetingClient(m),
    phoneRaw: m.lead?.phone ?? "",
    projectName: m.project?.name ?? "",
    subject: m.subject ?? "",
    startAt: m.startAt.toISOString(),
    place: m.place,
    status: m.status,
    confirmed: m.confirmed,
    setByName: m.setBy?.name ?? m.repName ?? null,
    hostName: m.host?.name ?? null,
    canEdit: canEditMeeting(u, m),
  }));
  const href = (extra: Record<string, string>) => `/meetings?${new URLSearchParams({ view: "list", range: range[0], who, ...extra })}`;
  return (
    <>
      <div className="toolbar">
        {!q && (
          <div className="seg" role="group" aria-label="מתי">
            {RANGES.map(([k, label]) => (
              <Link key={k} className={k === range[0] ? "on" : ""} href={href({ range: k })}>
                {label}
              </Link>
            ))}
          </div>
        )}
        {!q && can(u, "leads.view_all") && (
          <div className="seg" role="group" aria-label="של מי">
            <Link className={who === "mine" ? "on" : ""} href={href({ who: "mine" })}>
              שלי
            </Link>
            <Link className={who === "all" ? "on" : ""} href={href({ who: "all" })}>
              כל הצוות
            </Link>
          </div>
        )}
        {q ? (
          <Link className="filter on" href={href({})}>
            חיפוש: {q} <Icon name="x" />
          </Link>
        ) : (
          <form className="search msearch" role="search" action="/meetings">
            <input type="hidden" name="view" value="list" />
            <Icon name="search" />
            <input type="search" name="q" placeholder="חיפוש פגישה לפי שם או נושא" aria-label="חיפוש פגישות" />
          </form>
        )}
      </div>
      {q && <p className="search-note">{total ? `חיפשנו בכל הפגישות: ${total === 1 ? "נמצאה פגישה אחת" : `נמצאו ${total} פגישות`}` : ""}</p>}
      <MeetingsList rows={data} />
      {total > rows.length && (
        <div className="more-row">
          <Link className="btn sm" href={href({ limit: String(limit + STEP), ...(q ? { q } : {}) })} scroll={false}>
            הצגת עוד {Math.min(STEP, total - rows.length)} מתוך {total - rows.length}
          </Link>
        </div>
      )}
    </>
  );
}
