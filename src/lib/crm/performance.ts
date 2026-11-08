// Performance numbers for managers: by rep, by source and by project, for a chosen period.
// Two kinds of numbers, and the screen says which is which:
//  - leads that came in during the period, followed to today (relevant, meeting, held, deal): what each source brings;
//  - what happened during the period (calls, meetings set, meetings that were due, deals closed, hours): what the team did.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { shiftMinutes } from "@/lib/hours";
import { isSystemAdminRole } from "@/lib/settings";
import { addDays, at, DAY, fD, isWorkday, MON, monthStart, pad, sod, WD, weekStart } from "./dates";
import { PERIODS, ratio, type PeriodKey } from "./perfFormat";

// ---------------------------------------------------------------- the period

export type Range = { start: Date; end: Date };
export type BucketKind = "day" | "week" | "month";
export type Period = {
  key: PeriodKey;
  /** the days it covers, e.g. "1.11–8.11.2026" */
  title: string;
  /** what the comparison is against */
  vs: string;
  cur: Range;
  prev: Range;
  bucket: BucketKind;
  /** first and last day, for links and the custom range form */
  from: string;
  to: string;
};

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const earlier = (a: Date, b: Date) => (a < b ? a : b);
const monthsFrom = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

function parseDay(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getDate() === +m[3] && d.getMonth() === +m[2] - 1 ? d : null;
}

/** The longest custom range, so one screen never reads years of history. */
const MAX_DAYS = 366;

/** The period from the address (?p=month, or ?p=custom&from=&to=), and the period before it to compare with. */
export function periodOf(sp: { p?: string; from?: string; to?: string }, now = new Date()): Period {
  const key: PeriodKey = sp.p === "custom" || PERIODS.some((x) => x.key === sp.p) ? (sp.p as PeriodKey) : "month";
  // a running period is compared with the same stretch of time in the period before
  const sameStretch = (cur: Date, prevStart: Date) => earlier(new Date(prevStart.getTime() + (now.getTime() - cur.getTime())), cur);
  let cur: Range;
  let prev: Range;
  let vs: string;
  switch (key) {
    case "week": {
      const s = weekStart(now);
      const ps = addDays(s, -7);
      cur = { start: s, end: now };
      prev = { start: ps, end: sameStretch(s, ps) };
      vs = "לעומת אותם ימים בשבוע שעבר";
      break;
    }
    case "lweek": {
      const e = weekStart(now);
      const s = addDays(e, -7);
      cur = { start: s, end: e };
      prev = { start: addDays(s, -7), end: s };
      vs = "לעומת השבוע שלפניו";
      break;
    }
    case "month": {
      const s = monthStart(now);
      const ps = monthsFrom(s, -1);
      cur = { start: s, end: now };
      prev = { start: ps, end: sameStretch(s, ps) };
      vs = "לעומת אותם ימים בחודש שעבר";
      break;
    }
    case "lmonth": {
      const e = monthStart(now);
      const s = monthsFrom(e, -1);
      cur = { start: s, end: e };
      prev = { start: monthsFrom(s, -1), end: s };
      vs = "לעומת החודש שלפניו";
      break;
    }
    case "2m":
    case "3m": {
      const k = key === "2m" ? 2 : 3;
      const s = monthsFrom(monthStart(now), -(k - 1));
      const ps = monthsFrom(s, -k);
      cur = { start: s, end: now };
      prev = { start: ps, end: sameStretch(s, ps) };
      vs = k === 2 ? "לעומת החודשיים שלפני" : "לעומת 3 החודשים שלפני";
      break;
    }
    default: {
      let a = parseDay(sp.from) ?? monthStart(now);
      let b = parseDay(sp.to) ?? sod(now);
      if (b < a) [a, b] = [b, a];
      if (b > sod(now)) b = sod(now);
      if (a > b) a = b;
      if ((b.getTime() - a.getTime()) / DAY > MAX_DAYS) a = addDays(b, -MAX_DAYS);
      const days = Math.round((addDays(b, 1).getTime() - a.getTime()) / DAY);
      cur = { start: a, end: earlier(addDays(b, 1), now) };
      prev = { start: addDays(a, -days), end: a };
      vs = days === 1 ? "לעומת היום שלפני" : `לעומת ${days} הימים שלפני`;
    }
  }
  const last = new Date(cur.end.getTime() - 1);
  const span = (cur.end.getTime() - cur.start.getTime()) / DAY;
  return {
    key,
    title: sod(cur.start).getTime() === sod(last).getTime() ? `${fD(cur.start)}.${cur.start.getFullYear()}` : `${fD(cur.start)}–${fD(last)}.${last.getFullYear()}`,
    vs,
    cur,
    prev,
    bucket: span <= 14 ? "day" : span <= 124 ? "week" : "month",
    from: ymd(cur.start),
    to: ymd(last),
  };
}

// ---------------------------------------------------------------- definitions

/** A lead that should not have come in at all: it denies asking, or the number is wrong. */
export const JUNK_REASONS = ["הכחשת פנייה", "מספר לא תקין"];
const JUNK = new Set(JUNK_REASONS);

export type LeadFate = "untreated" | "unreached" | "junk" | "relevant";

/** Statuses that only follow a conversation. */
const TALKED_STATUSES = new Set(["meet", "resched", "held", "follow", "won", "lost"]);

/**
 * Where a lead stands today:
 *  junk      — denies asking, or the number is wrong;
 *  relevant  — a real person we talked to: an answered call, a meeting, or a status that only follows a conversation
 *              (also one who dropped out later for another reason: no interest, no budget, bought elsewhere);
 *  unreached — called or written to, but never got through;
 *  untreated — nobody has called or written yet.
 */
export function leadFate(l: { status: string; lostReason: string | null; touch: Date | null; met: boolean; talked: boolean }): LeadFate {
  if (l.status === "lost" && l.lostReason && JUNK.has(l.lostReason)) return "junk";
  if (l.met || l.talked || TALKED_STATUSES.has(l.status)) return "relevant";
  if (l.status === "noans" || l.touch) return "unreached";
  if (l.status === "new") return "untreated";
  // "בתהליך" set by hand with nothing logged: someone is already working on it
  return "relevant";
}

/** Working hours for response times: Sunday to Thursday, 8:00 to 20:00. */
const WORK_FROM = 8;
const WORK_TO = 20;

/** Minutes between two moments that fall inside working hours: a lead that arrives at night and gets a call at 8:10 waited 10 minutes. */
export function workMinutes(a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  let day = sod(a);
  // a lead that waited weeks counts as waiting the first 30 days
  for (let i = 0; i < 30 && day < b; i++, day = addDays(day, 1)) {
    if (!isWorkday(day)) continue;
    const s = Math.max(a.getTime(), at(day, WORK_FROM).getTime());
    const e = Math.min(b.getTime(), at(day, WORK_TO).getTime());
    if (e > s) total += e - s;
  }
  return Math.round(total / 60_000);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}


// ---------------------------------------------------------------- the rows behind the numbers

export type PerfFilter = { projectId: string | null; source: string | null; repId: string | null };

type CohortRow = {
  id: string;
  source: string;
  projectId: string | null;
  ownerId: string | null;
  status: string;
  lostReason: string | null;
  createdAt: Date;
  met: boolean;
  held: boolean;
  /** someone answered a call */
  talked: boolean;
  /** the first call, message or meeting by someone on the team */
  touch: Date | null;
};

const TOUCH = Prisma.sql`a.kind IN ('call', 'miss', 'wa', 'meeting')`;

/** Leads that came in during the range, with what happened to them since. */
async function cohort(r: Range, f: PerfFilter): Promise<CohortRow[]> {
  const where = [Prisma.sql`l."createdAt" >= ${r.start}`, Prisma.sql`l."createdAt" < ${r.end}`];
  if (f.projectId) where.push(Prisma.sql`l."projectId" = ${f.projectId}`);
  if (f.source) where.push(Prisma.sql`l.source = ${f.source}`);
  if (f.repId) where.push(Prisma.sql`l."ownerId" = ${f.repId}`);
  return prisma.$queryRaw<CohortRow[]>`
    SELECT l.id, l.source, l."projectId", l."ownerId", l.status, l."lostReason", l."createdAt",
      EXISTS (SELECT 1 FROM "Meeting" m WHERE m."leadId" = l.id) AS met,
      EXISTS (SELECT 1 FROM "Meeting" m WHERE m."leadId" = l.id AND m.status = 'held') AS held,
      EXISTS (SELECT 1 FROM "Activity" a WHERE a."leadId" = l.id AND a.kind = 'call' AND a."userId" IS NOT NULL) AS talked,
      (SELECT min(a."createdAt") FROM "Activity" a
        WHERE a."leadId" = l.id AND ${TOUCH} AND a."userId" IS NOT NULL AND a."createdAt" >= l."createdAt") AS touch
    FROM "Lead" l
    WHERE ${Prisma.join(where, " AND ")}`;
}

/** A lead that asked again during the range (not its first inquiry). */
async function returning(r: Range, f: PerfFilter): Promise<number> {
  const where = [Prisma.sql`i."createdAt" >= ${r.start}`, Prisma.sql`i."createdAt" < ${r.end}`];
  if (f.projectId) where.push(Prisma.sql`i."projectId" = ${f.projectId}`);
  if (f.source) where.push(Prisma.sql`i.source = ${f.source}`);
  if (f.repId) where.push(Prisma.sql`l."ownerId" = ${f.repId}`);
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "Inquiry" i JOIN "Lead" l ON l.id = i."leadId"
    WHERE ${Prisma.join(where, " AND ")}
      AND EXISTS (SELECT 1 FROM "Inquiry" j WHERE j."leadId" = i."leadId" AND j."createdAt" < i."createdAt")`;
  return row?.n ?? 0;
}

type AssignRow = { userId: string; leadId: string; start: Date; ownerId: string | null; touch: Date | null };

/** Leads handed to someone during the range, and when that person first called or wrote. */
async function handedOut(r: Range, f: PerfFilter): Promise<AssignRow[]> {
  const where = [Prisma.sql`la.at >= ${r.start}`, Prisma.sql`la.at < ${r.end}`];
  if (f.projectId) where.push(Prisma.sql`l."projectId" = ${f.projectId}`);
  if (f.source) where.push(Prisma.sql`l.source = ${f.source}`);
  if (f.repId) where.push(Prisma.sql`la."userId" = ${f.repId}`);
  return prisma.$queryRaw<AssignRow[]>`
    SELECT la."userId", la."leadId", GREATEST(la.at, l."createdAt") AS start, l."ownerId",
      (SELECT min(a."createdAt") FROM "Activity" a
        WHERE a."leadId" = la."leadId" AND a."userId" = la."userId" AND ${TOUCH} AND a."createdAt" >= la.at) AS touch
    FROM "LeadAssignment" la JOIN "Lead" l ON l.id = la."leadId"
    WHERE ${Prisma.join(where, " AND ")}`;
}

const leadWhere = (f: PerfFilter): Prisma.LeadWhereInput => ({
  ...(f.projectId ? { projectId: f.projectId } : {}),
  ...(f.source ? { source: f.source } : {}),
  ...(f.repId ? { ownerId: f.repId } : {}),
});

/** Meetings set during the range, or due during it. A meeting counts for whoever set it. */
function meetingsOf(r: Range, f: PerfFilter) {
  const and: Prisma.MeetingWhereInput[] = [{ OR: [{ createdAt: { gte: r.start, lt: r.end } }, { startAt: { gte: r.start, lt: r.end } }] }];
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.repId) and.push({ setById: f.repId });
  // a meeting's source is its lead's; a meeting without a lead keeps its own
  if (f.source) and.push({ OR: [{ lead: { source: f.source } }, { leadId: null, source: f.source }] });
  return prisma.meeting.findMany({ where: { AND: and }, select: { setById: true, createdAt: true, startAt: true, status: true } });
}

type MeetRow = Awaited<ReturnType<typeof meetingsOf>>[number];

const inRange = (d: Date, r: Range) => d >= r.start && d < r.end;

/** Meetings set in the range; and of those due in the range (up to now), how many took place, were cancelled, or were never updated. */
function meetStats(rows: MeetRow[], r: Range, now: Date) {
  const due: Range = { start: r.start, end: earlier(r.end, now) };
  const s = { set: 0, held: 0, canceled: 0, unmarked: 0 };
  for (const m of rows) {
    if (inRange(m.createdAt, r)) s.set++;
    if (!inRange(m.startAt, due)) continue;
    if (m.status === "held") s.held++;
    else if (m.status === "cancel") s.canceled++;
    else s.unmarked++;
  }
  return s;
}

// ---------------------------------------------------------------- the report

export type Mix = {
  leads: number;
  untreated: number;
  unreached: number;
  junk: number;
  relevant: number;
  /** relevant, but dropped out later (no interest, no budget, bought elsewhere) */
  dropped: number;
  met: number;
  held: number;
  won: number;
  topReason: string | null;
};

function mixOf(rows: CohortRow[]): Mix {
  const m: Mix = { leads: rows.length, untreated: 0, unreached: 0, junk: 0, relevant: 0, dropped: 0, met: 0, held: 0, won: 0, topReason: null };
  const reasons = new Map<string, number>();
  for (const l of rows) {
    const fate = leadFate(l);
    m[fate]++;
    if (fate === "relevant" && l.status === "lost") m.dropped++;
    if (l.status === "lost") reasons.set(l.lostReason || "בלי סיבה", (reasons.get(l.lostReason || "בלי סיבה") ?? 0) + 1);
    if (l.met) m.met++;
    if (l.held) m.held++;
    if (l.status === "won") m.won++;
  }
  m.topReason = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))[0]?.[0] ?? null;
  return m;
}

export type Tiles = {
  leads: number;
  returning: number;
  relevant: number;
  /** leads we could judge: relevant or junk */
  judged: number;
  relevantPct: number | null;
  set: number;
  held: number;
  canceled: number;
  unmarked: number;
  showUpPct: number | null;
  deals: number;
  /** median minutes, in working hours, from a lead's arrival to the first call or message */
  responseMin: number | null;
  responseOf: number;
};

async function tilesFor(r: Range, f: PerfFilter, now: Date, rows?: CohortRow[], meets?: MeetRow[]): Promise<Tiles> {
  const [c, m, back, deals] = await Promise.all([
    rows ?? cohort(r, f),
    meets ?? meetingsOf(r, f),
    returning(r, f),
    prisma.lead.count({ where: { ...leadWhere(f), status: "won", closedAt: { gte: r.start, lt: r.end } } }),
  ]);
  const mix = mixOf(c);
  const ms = meetStats(m, r, now);
  const waits = c.filter((l) => l.touch).map((l) => workMinutes(l.createdAt, l.touch as Date));
  return {
    leads: mix.leads,
    returning: back,
    relevant: mix.relevant,
    judged: mix.relevant + mix.junk,
    relevantPct: ratio(mix.relevant, mix.relevant + mix.junk),
    set: ms.set,
    held: ms.held,
    canceled: ms.canceled,
    unmarked: ms.unmarked,
    showUpPct: ratio(ms.held, ms.held + ms.canceled),
    deals,
    responseMin: median(waits),
    responseOf: waits.length,
  };
}

export type RepRow = {
  id: string;
  name: string;
  inactive: boolean;
  /** leads handed to this person in the period */
  received: number;
  /** of those, still theirs and never called or written to */
  untouched: number;
  calls: number;
  answered: number;
  responseMin: number | null;
  set: number;
  held: number;
  canceled: number;
  unmarked: number;
  showUpPct: number | null;
  deals: number;
  /** minutes worked, from the signed hours */
  minutes: number;
};

export type MixRow = Mix & { key: string; label: string };
export type Bucket = { short: string; long: string; leads: number; set: number; held: number };

export type PerfReport = {
  tiles: Tiles;
  prev: Tiles;
  funnel: [number, number, number, number, number];
  mix: Mix;
  buckets: Bucket[];
  reps: RepRow[];
  sources: MixRow[];
  projects: MixRow[];
};

const SHORT_WD = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const SHORT_MON = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

/** The chart's columns: days for a week or two, weeks for up to four months, months beyond. */
function bucketsOf(r: Range, kind: BucketKind): { start: Date; short: string; long: string }[] {
  const out: { start: Date; short: string; long: string }[] = [];
  let d = kind === "day" ? sod(r.start) : kind === "week" ? weekStart(r.start) : monthStart(r.start);
  const next = (x: Date) => (kind === "day" ? addDays(x, 1) : kind === "week" ? addDays(x, 7) : monthsFrom(x, 1));
  while (d < r.end) {
    const n = next(d);
    const from = d < r.start ? r.start : d;
    const to = new Date(earlier(n, r.end).getTime() - 1);
    // a day's label is two short lines: the weekday over the date
    if (kind === "day") out.push({ start: d, short: `${SHORT_WD[d.getDay()]}\n${fD(d)}`, long: `${WD[d.getDay()]} ${fD(d)}` });
    else if (kind === "week") out.push({ start: d, short: fD(from), long: sod(from).getTime() === sod(to).getTime() ? fD(from) : `${fD(from)}–${fD(to)}` });
    else out.push({ start: d, short: SHORT_MON[d.getMonth()], long: `${MON[d.getMonth()]} ${d.getFullYear()}` });
    d = n;
  }
  return out;
}

function bucketIndex(starts: Date[], t: Date): number {
  let i = -1;
  for (let k = 0; k < starts.length && starts[k] <= t; k++) i = k;
  return i;
}

export async function performance(p: Period, f: PerfFilter, now = new Date()): Promise<PerfReport> {
  const r = p.cur;
  const [rows, meets, assigned, calls, dealsBy, shifts, users, projects] = await Promise.all([
    cohort(r, f),
    meetingsOf(r, f),
    handedOut(r, f),
    prisma.activity.groupBy({
      by: ["userId", "kind"],
      where: {
        kind: { in: ["call", "miss"] },
        createdAt: { gte: r.start, lt: r.end },
        userId: f.repId ?? { not: null },
        ...(f.projectId || f.source ? { lead: { ...(f.projectId ? { projectId: f.projectId } : {}), ...(f.source ? { source: f.source } : {}) } } : {}),
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ...leadWhere(f), status: "won", closedAt: { gte: r.start, lt: r.end } }, _count: { _all: true } }),
    prisma.workShift.findMany({ where: { startAt: { gte: r.start, lt: r.end }, ...(f.repId ? { userId: f.repId } : {}) }, select: { userId: true, startAt: true, endAt: true } }),
    prisma.user.findMany({ select: { id: true, name: true, active: true, deletedAt: true, role: { select: { locked: true, permissions: true } } } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
  ]);
  const [tiles, prev] = await Promise.all([tilesFor(r, f, now, rows, meets), tilesFor(p.prev, f, now)]);
  const mix = mixOf(rows);

  // ---- people: agents and sales managers, not system administrators
  const reps = new Map<string, RepRow>();
  const isRep = new Map(users.map((u) => [u.id, !isSystemAdminRole(u.role)]));
  const rep = (id: string | null | undefined): RepRow | null => {
    if (!id || !isRep.get(id)) return null;
    let row = reps.get(id);
    if (!row) {
      const u = users.find((x) => x.id === id);
      row = { id, name: u?.name ?? "", inactive: !u?.active || !!u?.deletedAt, received: 0, untouched: 0, calls: 0, answered: 0, responseMin: null, set: 0, held: 0, canceled: 0, unmarked: 0, showUpPct: null, deals: 0, minutes: 0 };
      reps.set(id, row);
    }
    return row;
  };
  // everyone active is listed, even with nothing yet in the period
  for (const u of users) if (u.active && !u.deletedAt && (!f.repId || u.id === f.repId)) rep(u.id);

  const waits = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const a of assigned) {
    const row = rep(a.userId);
    if (!row) continue;
    const k = a.userId + ":" + a.leadId;
    if (!seen.has(k)) {
      seen.add(k);
      row.received++;
      if (!a.touch && a.ownerId === a.userId) row.untouched++;
    }
    if (a.touch) waits.set(a.userId, [...(waits.get(a.userId) ?? []), workMinutes(a.start, a.touch)]);
  }
  for (const [id, list] of waits) {
    const row = reps.get(id);
    if (row) row.responseMin = median(list);
  }
  for (const c of calls) {
    const row = rep(c.userId);
    if (!row) continue;
    row.calls += c._count._all;
    if (c.kind === "call") row.answered += c._count._all;
  }
  const due: Range = { start: r.start, end: earlier(r.end, now) };
  for (const m of meets) {
    const row = rep(m.setById);
    if (!row) continue;
    if (inRange(m.createdAt, r)) row.set++;
    if (!inRange(m.startAt, due)) continue;
    if (m.status === "held") row.held++;
    else if (m.status === "cancel") row.canceled++;
    else row.unmarked++;
  }
  for (const d of dealsBy) {
    const row = rep(d.ownerId);
    if (row) row.deals += d._count._all;
  }
  for (const s of shifts) {
    const row = rep(s.userId);
    if (row) row.minutes += shiftMinutes(s);
  }
  for (const row of reps.values()) row.showUpPct = ratio(row.held, row.held + row.canceled);
  const repRows = [...reps.values()]
    // people who left show only when they have numbers in the period
    .filter((x) => !x.inactive || x.received || x.calls || x.set || x.held || x.canceled || x.deals || x.minutes)
    .sort((a, b) => b.set - a.set || b.received - a.received || b.calls - a.calls || a.name.localeCompare(b.name, "he"));

  // ---- by source and by project, from the leads that came in
  const group = (key: (l: CohortRow) => string, label: (k: string) => string): MixRow[] => {
    const by = new Map<string, CohortRow[]>();
    for (const l of rows) by.set(key(l), [...(by.get(key(l)) ?? []), l]);
    return [...by]
      .map(([k, list]) => ({ key: k, label: label(k), ...mixOf(list) }))
      .sort((a, b) => b.leads - a.leads || b.met - a.met || a.label.localeCompare(b.label, "he"));
  };
  const projectName = new Map(projects.map((x) => [x.id, x.name]));
  const sources = group((l) => l.source, (k) => k);
  const byProject = group((l) => l.projectId ?? "", (k) => (k ? (projectName.get(k) ?? "פרויקט שנמחק") : "בלי פרויקט"))
    // "no project" goes last
    .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1));

  // ---- the charts
  const cols = bucketsOf(r, p.bucket);
  const starts = cols.map((c) => c.start);
  const buckets: Bucket[] = cols.map((c) => ({ short: c.short, long: c.long, leads: 0, set: 0, held: 0 }));
  for (const l of rows) {
    const i = bucketIndex(starts, l.createdAt);
    if (i >= 0) buckets[i].leads++;
  }
  for (const m of meets) {
    if (inRange(m.createdAt, r)) {
      const i = bucketIndex(starts, m.createdAt);
      if (i >= 0) buckets[i].set++;
    }
    if (m.status === "held" && inRange(m.startAt, due)) {
      const i = bucketIndex(starts, m.startAt);
      if (i >= 0) buckets[i].held++;
    }
  }

  return {
    tiles,
    prev,
    funnel: [mix.leads, mix.relevant, mix.met, mix.held, mix.won],
    mix,
    buckets,
    reps: repRows,
    sources,
    projects: byProject,
  };
}

/** The choices for the filters: projects, sources that brought leads, and the people who report. */
export async function performanceOptions() {
  const [projects, sources, users] = await Promise.all([
    prisma.project.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, orderBy: { _count: { source: "desc" } }, take: 60 }),
    prisma.user.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true, role: { select: { locked: true, permissions: true } } } }),
  ]);
  return {
    projects: projects.map((x) => ({ id: x.id, label: x.name + (x.active ? "" : " (לא פעיל)") })),
    sources: sources.map((s) => s.source).sort((a, b) => a.localeCompare(b, "he")),
    reps: users.filter((u) => !isSystemAdminRole(u.role)).map((u) => ({ id: u.id, label: u.name + (u.active ? "" : " (לא פעיל)") })),
  };
}
