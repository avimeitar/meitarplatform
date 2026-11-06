import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { meetingClient } from "@/lib/crm/constants";
import { addDays, dayLabel, nextWorkday, sod, weekStart } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { can, requirePageUser } from "@/lib/session";
import { MeetingsList, NewMeetingButton, type MeetingRowData } from "./MeetingsList";

export const metadata = { title: "פגישות" };

const STEP = 100;

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const manager = can(u, "reports.view");
  const now = new Date();
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
  const who = sp.who === "all" || (manager && sp.who !== "mine") ? "all" : "mine";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const limit = Math.min(2000, Math.max(STEP, Number(sp.limit) || STEP));
  const mineWhere: Prisma.MeetingWhereInput = { OR: [{ setById: u.id }, { hostId: u.id }, { lead: { ownerId: u.id } }] };
  const scope: Prisma.MeetingWhereInput = can(u, "leads.view_all") ? {} : mineWhere;
  // a search looks through every meeting this person may see, at any date
  const where: Prisma.MeetingWhereInput = q
    ? { AND: [scope, { OR: [{ clientName: { contains: q, mode: "insensitive" } }, { lead: { name: { contains: q, mode: "insensitive" } } }, { subject: { contains: q, mode: "insensitive" } }] }] }
    : { AND: [scope, range[2], who === "mine" ? mineWhere : {}, sp.status ? { status: sp.status } : {}] };
  const asc = !q && range[0] !== "past";
  const [rows, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: { startAt: asc ? "asc" : "desc" },
      take: limit,
      include: { lead: { select: { id: true, name: true, phone: true, ownerId: true } }, project: { select: { name: true } }, setBy: { select: { name: true } }, host: { select: { name: true } } },
    }),
    prisma.meeting.count({ where }),
  ]);
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
    canEdit: can(u, "leads.edit") && (m.setById === u.id || m.hostId === u.id || m.lead?.ownerId === u.id || can(u, "meetings.manage_all")),
  }));
  const href = (extra: Record<string, string>) => `/meetings?${new URLSearchParams({ range: range[0], who, ...extra })}`;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>
            פגישות {q ? <span className="count-lg">{total}</span> : null}
          </h1>
          <p className="sub">אחרי כל פגישה מסמנים מה קרה: התקיימה או בוטלה. אם הפגישה שייכת לליד, הוא מתעדכן לבד.</p>
        </div>
        <div className="head-actions">{can(u, "leads.edit") && <NewMeetingButton />}</div>
      </div>
      {kpis && !q && (
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
    </section>
  );
}
