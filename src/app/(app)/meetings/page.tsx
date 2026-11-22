import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { isMeetingState, MEETING_STATE_ORDER, MEETING_STATES, meetingClient, meetingState, NOT_HELD, type MeetingState } from "@/lib/crm/constants";
import { addDays, dayLabel, nextWorkday, sod, weekStart } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { getLists } from "@/lib/lists";
import { can, requirePageUser, type CurrentUser } from "@/lib/session";
import { CalendarFilters } from "./CalendarFilters";
import { canEditMeeting, filterWhere, include, meetingsContext, type MeetingsContext, type Params } from "./common";
import { MeetingsList, NewMeetingButton, type MeetingRowData } from "./MeetingsList";

export const metadata = { title: "פגישות" };

const STEP = 100;

/** The meetings to book and update: a list with status tabs. The calendar, for viewing, has its own screen (/calendar). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  // an old link to the calendar on this screen
  if (sp.view === "cal") {
    const rest = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "view" && v) as [string, string][]);
    redirect(`/calendar${rest.size ? `?${rest}` : ""}`);
  }
  const ctx = await meetingsContext(u, sp);
  const now = new Date();
  const today = sod(now);

  let kpis: { upcoming: number; held: number; cancel: number } | null = null;
  if (ctx.manager) {
    const since = addDays(today, -29);
    const [up, held, cancel] = await Promise.all([
      prisma.meeting.count({ where: { status: "set", startAt: { gte: now } } }),
      prisma.meeting.count({ where: { status: "held", startAt: { gte: since, lt: addDays(today, 1) } } }),
      prisma.meeting.count({ where: { status: { in: NOT_HELD }, startAt: { gte: since, lt: addDays(today, 1) } } }),
    ]);
    kpis = { upcoming: up, held, cancel };
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>פגישות</h1>
          <p className="sub">קובעים פגישות, ואחרי כל פגישה מסמנים מה קרה: התקיימה, אי-הגעה, בוטלה או לתאם מחדש. אם הפגישה שייכת ללקוח, הוא מתעדכן לבד.</p>
        </div>
        <div className="head-actions">
          <Link className="btn ghost" href="/calendar">
            <Icon name="cal" />
            ליומן הפגישות
          </Link>
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
            <span>לא התקיימו ב-30 יום</span>
            <b>{kpis.cancel}</b>
          </div>
          <div className="kpi">
            <span>אחוז הפגישות שהתקיימו</span>
            <b>{kpis.held + kpis.cancel ? Math.round((kpis.held / (kpis.held + kpis.cancel)) * 100) + "%" : "0%"}</b>
          </div>
        </div>
      )}
      <ListView u={u} sp={sp} ctx={ctx} now={now} />
    </section>
  );
}

// ---------------------------------------------------------------- the list

async function ListView({ u, sp, ctx, now }: { u: CurrentUser; sp: Params; ctx: MeetingsContext; now: Date }) {
  const { manager, who, scope, mineWhere, filters, options } = ctx;
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
  // the status tabs, like the leads list: "אושרה הגעה" is a set meeting with the arrival confirmed
  const st: MeetingState | null = sp.st && isMeetingState(sp.st) ? sp.st : null;
  const stateWhere = (s: MeetingState): Prisma.MeetingWhereInput => (s === "set" ? { status: "set", confirmed: false } : s === "confirmed" ? { status: "set", confirmed: true } : { status: s });
  const base: Prisma.MeetingWhereInput = { AND: [scope, range[2], who === "mine" ? mineWhere : {}, ...filterWhere(filters)] };
  // a search looks through every meeting this person may see, at any date
  const where: Prisma.MeetingWhereInput = q
    ? { AND: [scope, { OR: [{ clientName: { contains: q, mode: "insensitive" } }, { lead: { name: { contains: q, mode: "insensitive" } } }, { subject: { contains: q, mode: "insensitive" } }] }] }
    : st
      ? { AND: [base, stateWhere(st)] }
      : base;
  const asc = !q && range[0] !== "past";
  const [rows, total, byState] = await Promise.all([
    prisma.meeting.findMany({ where, orderBy: { startAt: asc ? "asc" : "desc" }, take: limit, include }),
    prisma.meeting.count({ where }),
    q ? Promise.resolve([]) : prisma.meeting.groupBy({ by: ["status", "confirmed"], where: base, _count: { _all: true } }),
  ]);
  const names = (await getLists()).meeting;
  const counts = Object.fromEntries(MEETING_STATE_ORDER.map((s) => [s, 0])) as Record<MeetingState, number>;
  for (const g of byState) counts[meetingState(g)] += g._count._all;
  const all = MEETING_STATE_ORDER.reduce((n, s) => n + counts[s], 0);
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
  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ view: "list", range: range[0], who, st: st ?? "", person: filters.person, project: filters.project, ...extra }).filter(([, v]) => v));
    return `/meetings?${p}`;
  };
  return (
    <>
      {!q && (
        <div className="views mviews" role="group" aria-label="סטטוס הפגישה">
          <Link className={"view" + (!st ? " on" : "")} href={href({ st: "" })} aria-current={!st ? "page" : undefined}>
            הכול <b>{all}</b>
          </Link>
          {MEETING_STATE_ORDER.map((s) => (
            <Link key={s} className={"view " + MEETING_STATES[s].c + (st === s ? " on" : "")} href={href({ st: s })} aria-current={st === s ? "page" : undefined}>
              {names[s]} <b>{counts[s]}</b>
            </Link>
          ))}
        </div>
      )}
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
        {!q && <CalendarFilters view="list" people={options.people} projects={options.projects} person={filters.person} project={filters.project} cancelled={false} />}
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
