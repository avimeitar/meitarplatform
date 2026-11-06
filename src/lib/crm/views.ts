// Read models for the screens: everything returned here is plain JSON (dates as ISO strings).
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, type CurrentUser } from "@/lib/session";
import { meetingClient } from "./constants";
import { addDays, monthStart, nextWorkday, nightStart, sod, weekStart } from "./dates";
import { buildQueue } from "./service";

const RECENT_DONE_MS = 15 * 60_000;

export type AgendaItem = { id: string; leadId: string | null; leadName: string; projectName: string; startAt: string; place: string; status: string; confirmed: boolean; hostName: string | null };
export type TaskRow = { id: string; title: string; dueAt: string; done: boolean; leadId: string | null; leadName: string | null; userName: string | null };
export type QueueRow = { leadId: string; name: string; phone: string; phoneRaw: string; status: string; projectName: string; source: string; why: string; late: boolean; meetingId?: string; lastWa: string | null; attempts: number };

export function leadScope(u: CurrentUser): Prisma.LeadWhereInput {
  return can(u, "leads.view_all") ? {} : { ownerId: u.id };
}

/** Open tasks, plus ones finished in the last few minutes so the list doesn't jump after a tap. */
export function openTaskWhere(extra: Prisma.TaskWhereInput = {}): Prisma.TaskWhereInput {
  return { AND: [extra, { OR: [{ done: false }, { done: true, voided: false, doneAt: { gte: new Date(Date.now() - RECENT_DONE_MS) } }] }] };
}

export function taskRow(t: { id: string; title: string; dueAt: Date; done: boolean; leadId: string | null; lead?: { name: string } | null; user?: { name: string } | null }): TaskRow {
  return { id: t.id, title: t.title, dueAt: t.dueAt.toISOString(), done: t.done, leadId: t.leadId, leadName: t.lead?.name ?? null, userName: t.user?.name ?? null };
}

export async function agendaFor(where: Prisma.MeetingWhereInput, now = new Date()): Promise<AgendaItem[]> {
  const today = sod(now);
  const next = nextWorkday(now);
  const rows = await prisma.meeting.findMany({
    where: { AND: [where, { status: { not: "cancel" } }, { OR: [{ startAt: { gte: today, lt: addDays(today, 1) } }, { startAt: { gte: next, lt: addDays(next, 1) } }] }] },
    orderBy: { startAt: "asc" },
    include: { lead: { select: { name: true } }, project: { select: { name: true } }, host: { select: { name: true } } },
  });
  return rows.map((m) => ({ id: m.id, leadId: m.leadId, leadName: meetingClient(m), projectName: m.project?.name ?? "", startAt: m.startAt.toISOString(), place: m.place, status: m.status, confirmed: m.confirmed, hostName: m.host?.name ?? null }));
}

export async function queueRows(userId: string): Promise<QueueRow[]> {
  const q = await buildQueue(userId);
  if (!q.length) return [];
  const leads = await prisma.lead.findMany({
    where: { id: { in: q.map((x) => x.leadId) } },
    include: { project: { select: { name: true } }, activities: { where: { kind: "wa" }, orderBy: { createdAt: "desc" }, take: 1, select: { text: true } } },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));
  const rows: QueueRow[] = [];
  for (const x of q) {
    const l = byId.get(x.leadId);
    if (!l) continue;
    rows.push({ leadId: l.id, name: l.name, phone: formatPhone(l.phone), phoneRaw: l.phone, status: l.status, projectName: l.project?.name ?? "", source: l.source, why: x.why, late: x.late, meetingId: x.meetingId, lastWa: l.activities[0]?.text ?? null, attempts: l.attempts });
  }
  return rows;
}

export async function agentHome(u: CurrentUser) {
  const today = sod(new Date());
  const [queue, meetings, tasks, calls, meets] = await Promise.all([
    queueRows(u.id),
    agendaFor({ OR: [{ setById: u.id }, { hostId: u.id }] }),
    prisma.task.findMany({ where: openTaskWhere({ userId: u.id }), orderBy: { dueAt: "asc" }, take: 12, include: { lead: { select: { name: true } } } }),
    prisma.activity.count({ where: { userId: u.id, kind: { in: ["call", "miss"] }, createdAt: { gte: today } } }),
    prisma.meeting.count({ where: { setById: u.id, createdAt: { gte: today } } }),
  ]);
  return { queue, meetings, tasks: tasks.map(taskRow), calls, meets };
}

export async function managerDashboard(days: number) {
  const now = new Date();
  const today = sod(now);
  const night = nightStart(now);
  const since = days === 1 ? today : addDays(today, -(days - 1));
  const [overnight, agenda, stale, overdue, people, funnelLeads, metLeads, heldLeads, wonLeads, contacted] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: night } }, orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } }, project: { select: { name: true } } }, take: 60 }),
    agendaFor({}),
    prisma.meeting.count({ where: { status: "set", startAt: { lt: now } } }),
    prisma.task.count({ where: { done: false, dueAt: { lt: today } } }),
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, meetings: { some: {} } } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, meetings: { some: { status: "held" } } } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, status: "won" } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, status: { notIn: ["new", "noans"] }, NOT: { status: "lost", lostReason: "מספר לא תקין" } } }),
  ]);
  const wk = weekStart(now);
  const taskStats = await Promise.all(
    people.map(async (p) => {
      const [open, late, dueToday, doneWeek] = await Promise.all([
        prisma.task.count({ where: { userId: p.id, done: false } }),
        prisma.task.count({ where: { userId: p.id, done: false, dueAt: { lt: today } } }),
        prisma.task.count({ where: { userId: p.id, done: false, dueAt: { gte: today, lt: addDays(today, 1) } } }),
        prisma.task.count({ where: { userId: p.id, done: true, voided: false, doneAt: { gte: wk } } }),
      ]);
      return { id: p.id, name: p.name, open, late, dueToday, doneWeek };
    }),
  );
  const monthWon = await prisma.lead.count({ where: { status: "won", closedAt: { gte: monthStart(now) } } });
  return {
    nightStart: night.toISOString(),
    overnight: overnight.map((l) => ({ id: l.id, name: l.name, projectName: l.project?.name ?? "", source: l.source, createdAt: l.createdAt.toISOString(), ownerName: l.owner?.name ?? null, ownerId: l.ownerId })),
    agenda,
    stale,
    overdue,
    people,
    taskStats,
    funnel: [funnelLeads, contacted, metLeads, heldLeads, wonLeads],
    monthWon,
  };
}
