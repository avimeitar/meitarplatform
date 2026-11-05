// Numbers for the manager reports: projects and closed deals.
// Everything is counted in the database (count and groupBy), so the screens stay fast however many leads there are.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isLeadStatus, ST_ORDER, type LeadStatus } from "./constants";
import { addDays, monthStart, sod } from "./dates";

/** A deal: a lead marked "נחתמה עסקה", with the date it closed. */
const DEAL = { status: "won", closedAt: { not: null } } satisfies Prisma.LeadWhereInput;

/** "Last 30 days" for meetings: today and the 29 days before it. */
function last30(now: Date) {
  return { gte: sod(addDays(now, -29)), lt: addDays(sod(now), 1) };
}

/** a / b as a percent. Under 10% it keeps one decimal, so a real 0.4% does not show as 0%. */
export function pct(a: number, b: number): string {
  if (!a || !b) return "0%";
  const v = (a / b) * 100;
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "%";
}

const n = (r: { _count: { _all: number } } | undefined) => r?._count._all ?? 0;

// ---------------------------------------------------------------- projects

export type StatusCounts = Record<LeadStatus, number>;

export type ProjectSummary = {
  id: string;
  name: string;
  fullName: string;
  place: string;
  byStatus: StatusCounts;
  leads: number;
  newThisMonth: number;
  /** held in the last 30 days */
  meetingsHeld: number;
  dealsThisMonth: number;
  deals: number;
  topSource: string | null;
};

const emptyStatuses = (): StatusCounts => Object.fromEntries(ST_ORDER.map((s) => [s, 0])) as StatusCounts;

/** One row per active project, in the order the projects are listed everywhere else. */
export async function projectSummaries(now = new Date()): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  if (!projects.length) return [];
  const inProjects = { projectId: { in: projects.map((p) => p.id) } };
  const month = monthStart(now);
  const [byStatus, newThisMonth, held, dealsThisMonth, deals, sources] = await Promise.all([
    prisma.lead.groupBy({ by: ["projectId", "status"], where: inProjects, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["projectId"], where: { ...inProjects, createdAt: { gte: month } }, _count: { _all: true } }),
    prisma.meeting.groupBy({ by: ["projectId"], where: { ...inProjects, status: "held", startAt: last30(now) }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["projectId"], where: { ...inProjects, ...DEAL, closedAt: { gte: month } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["projectId"], where: { ...inProjects, ...DEAL }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["projectId", "source"], where: inProjects, _count: { _all: true } }),
  ]);
  return projects.map((p) => {
    const st = emptyStatuses();
    for (const r of byStatus) if (r.projectId === p.id && isLeadStatus(r.status)) st[r.status] += n(r);
    const top = sources.filter((r) => r.projectId === p.id).sort((a, b) => n(b) - n(a) || a.source.localeCompare(b.source, "he"))[0];
    return {
      id: p.id,
      name: p.name,
      fullName: p.fullName,
      place: p.place,
      byStatus: st,
      leads: ST_ORDER.reduce((s, k) => s + st[k], 0),
      newThisMonth: n(newThisMonth.find((r) => r.projectId === p.id)),
      meetingsHeld: n(held.find((r) => r.projectId === p.id)),
      dealsThisMonth: n(dealsThisMonth.find((r) => r.projectId === p.id)),
      deals: n(deals.find((r) => r.projectId === p.id)),
      topSource: top?.source ?? null,
    };
  });
}

export type BreakdownRow = { key: string | null; label: string; inactive: boolean; leads: number; newThisMonth: number; meetingsHeld: number; deals: number };

function rows(values: Iterable<BreakdownRow>): BreakdownRow[] {
  // most leads first; "not assigned" always last
  return [...values].sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || b.leads - a.leads || b.deals - a.deals || a.label.localeCompare(b.label, "he"));
}

/** One project's numbers by agent (the lead's owner) and by source. */
export async function projectBreakdown(projectId: string, now = new Date()): Promise<{ byOwner: BreakdownRow[]; bySource: BreakdownRow[] }> {
  const where = { projectId };
  const [leads, newThisMonth, deals, held] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerId", "source"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId", "source"], where: { ...where, createdAt: { gte: monthStart(now) } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId", "source"], where: { ...where, ...DEAL }, _count: { _all: true } }),
    // held meetings of one project in 30 days: a short list, counted by the lead's owner and source below
    prisma.meeting.findMany({ where: { projectId, status: "held", startAt: last30(now) }, select: { lead: { select: { ownerId: true, source: true } } } }),
  ]);
  // a held meeting can belong to a lead that has since moved to another project, so its owner counts too
  const ownerIds = [...new Set([...leads.map((r) => r.ownerId), ...held.map((m) => m.lead.ownerId)].filter((x): x is string => !!x))];
  const people = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, active: true, deletedAt: true } });
  const person = new Map(people.map((u) => [u.id, u]));

  const byOwner = new Map<string | null, BreakdownRow>();
  const bySource = new Map<string, BreakdownRow>();
  const ownerRow = (id: string | null) => {
    let r = byOwner.get(id);
    if (!r) {
      const u = id ? person.get(id) : undefined;
      r = { key: id, label: u?.name ?? "לא שויך", inactive: !!u && (!u.active || !!u.deletedAt), leads: 0, newThisMonth: 0, meetingsHeld: 0, deals: 0 };
      byOwner.set(id, r);
    }
    return r;
  };
  const sourceRow = (s: string) => {
    let r = bySource.get(s);
    if (!r) bySource.set(s, (r = { key: s, label: s, inactive: false, leads: 0, newThisMonth: 0, meetingsHeld: 0, deals: 0 }));
    return r;
  };
  const add = (list: { ownerId: string | null; source: string; _count: { _all: number } }[], field: "leads" | "newThisMonth" | "deals") => {
    for (const r of list) {
      ownerRow(r.ownerId)[field] += n(r);
      sourceRow(r.source)[field] += n(r);
    }
  };
  add(leads, "leads");
  add(newThisMonth, "newThisMonth");
  add(deals, "deals");
  for (const m of held) {
    ownerRow(m.lead.ownerId).meetingsHeld++;
    sourceRow(m.lead.source).meetingsHeld++;
  }
  return { byOwner: rows(byOwner.values()), bySource: rows(bySource.values()) };
}

// ---------------------------------------------------------------- closed deals

export type DealsFilter = { projectId: string | null; ownerId: string | null };

/** Deals of one person, project or source. A null key is "not assigned" or "no project". */
export type DealCount = { key: string | null; deals: number };

/** Biggest first. Ties keep a fixed order, and rows without a key go last. */
function ranked<T extends DealCount>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || b.deals - a.deals || String(a.key).localeCompare(String(b.key), "he"));
}

export type DealsReport = {
  months: { start: Date; deals: number }[];
  total: number;
  /** leads that came in during the same six months, for "from lead to deal" */
  leads: number;
  byOwner: DealCount[];
  byProject: DealCount[];
  bySource: { key: string; deals: number }[];
  list: { id: string; name: string; closedAt: Date; source: string; project: string | null; ownerId: string | null; owner: string | null }[];
};

/** The six months of the deals report: the first day of each month, oldest first, and the end of this month. */
function dealsWindow(now: Date) {
  const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
  return { months, since: months[0], until: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

export async function dealsReport(f: DealsFilter, page: { skip: number; take: number }, now = new Date()): Promise<DealsReport> {
  const { months, since, until } = dealsWindow(now);
  const scope: Prisma.LeadWhereInput = { ...(f.projectId ? { projectId: f.projectId } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}) };
  const where: Prisma.LeadWhereInput = { ...scope, ...DEAL, closedAt: { gte: since, lt: until } };
  const [perMonth, byOwner, byProject, bySource, list, leads] = await Promise.all([
    Promise.all(months.map((m, i) => prisma.lead.count({ where: { ...where, closedAt: { gte: m, lt: months[i + 1] ?? until } } }))),
    prisma.lead.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["projectId"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where, _count: { _all: true } }),
    prisma.lead.findMany({
      where,
      orderBy: [{ closedAt: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
      select: { id: true, name: true, closedAt: true, source: true, project: { select: { name: true } }, owner: { select: { id: true, name: true } } },
    }),
    prisma.lead.count({ where: { ...scope, createdAt: { gte: since, lt: until } } }),
  ]);
  return {
    months: months.map((start, i) => ({ start, deals: perMonth[i] })),
    total: perMonth.reduce((s, x) => s + x, 0),
    leads,
    byOwner: ranked(byOwner.map((r) => ({ key: r.ownerId, deals: n(r) }))),
    byProject: ranked(byProject.map((r) => ({ key: r.projectId, deals: n(r) }))),
    bySource: ranked(bySource.map((r) => ({ key: r.source, deals: n(r) }))),
    list: list.map((l) => ({ id: l.id, name: l.name, closedAt: l.closedAt as Date, source: l.source, project: l.project?.name ?? null, ownerId: l.owner?.id ?? null, owner: l.owner?.name ?? null })),
  };
}

/** Who can be picked in the deals filter: everyone active, and anyone who closed a deal in the window (also people who left). */
export async function dealsPeople(now = new Date()) {
  const { since, until } = dealsWindow(now);
  const owners = await prisma.lead.groupBy({ by: ["ownerId"], where: { ...DEAL, closedAt: { gte: since, lt: until } }, _count: { _all: true } });
  const ids = owners.map((o) => o.ownerId).filter((x): x is string => !!x);
  const people = await prisma.user.findMany({
    where: { OR: [{ active: true, deletedAt: null }, { id: { in: ids } }] },
    select: { id: true, name: true, active: true, deletedAt: true },
    orderBy: { name: "asc" },
  });
  return people.map((u) => ({ id: u.id, name: u.name, inactive: !u.active || !!u.deletedAt }));
}
