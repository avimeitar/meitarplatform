// The archive: clients, meetings, tasks and projects that left the working system, kept read only for the
// system administrators. A move to the archive copies everything first and removes it from the system only
// after the copy is complete, in one transaction: it either all happens or nothing does.
import type { Prisma } from "@/generated/prisma/client";
import { taskState } from "./crm/constants";
import { prisma } from "./db";

export { ARCHIVE_KINDS, CONFIRM_WORDS, isArchiveKind, likelyKept, type ArchiveCounts, type ArchiveKind } from "./archive-words";
import type { ArchiveCounts } from "./archive-words";

/** What a move would take: everything except the projects that stay (those stay, empty). */
export async function archivePreview(keepProjectIds: string[]): Promise<ArchiveCounts> {
  const [leads, meetings, tasks, projects] = await Promise.all([
    prisma.lead.count(),
    prisma.meeting.count(),
    prisma.task.count(),
    prisma.project.count({ where: { id: { notIn: keepProjectIds } } }),
  ]);
  return { leads, meetings, tasks, projects };
}

const CHUNK = 200;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Rows by the client they belong to. */
function group<T extends { leadId: string | null }>(rows: T[]): (leadId: string) => T[] {
  const by = new Map<string, T[]>();
  for (const r of rows) if (r.leadId) by.set(r.leadId, [...(by.get(r.leadId) ?? []), r]);
  return (leadId) => by.get(leadId) ?? [];
}

type Names = { user: (id: string | null | undefined) => string | null; project: (id: string | null | undefined) => string | null };

type MeetingRow = Prisma.MeetingGetPayload<object>;
type TaskRow = Prisma.TaskGetPayload<object>;

function meetingData(m: MeetingRow, n: Names) {
  return {
    startAt: iso(m.startAt),
    client: m.clientName,
    subject: m.subject,
    source: m.source,
    project: n.project(m.projectId),
    place: m.place,
    status: m.status,
    confirmed: m.confirmed,
    setBy: n.user(m.setById) ?? m.repName,
    host: n.user(m.hostId),
    note: m.note,
    createdAt: iso(m.createdAt),
  };
}

function taskData(t: TaskRow, n: Names) {
  return { title: t.title, dueAt: iso(t.dueAt), state: taskState(t), doneAt: iso(t.doneAt), user: n.user(t.userId), createdBy: n.user(t.createdById), auto: t.auto, createdAt: iso(t.createdAt) };
}

type Client = { id: string; name: string; phone: string };

function meetingRecord(batchId: string, m: MeetingRow, n: Names, client?: Client): Prisma.ArchiveRecordCreateManyInput {
  return {
    batchId,
    kind: "meeting",
    originalId: m.id,
    name: client?.name || m.clientName || m.subject || "פגישה",
    phone: client?.phone ?? null,
    project: n.project(m.projectId),
    status: m.status,
    owner: n.user(m.hostId) ?? n.user(m.setById) ?? m.repName,
    at: m.startAt,
    data: { ...meetingData(m, n), clientId: client?.id ?? null } as Prisma.InputJsonValue,
  };
}

function taskRecord(batchId: string, t: TaskRow, n: Names, client?: Client): Prisma.ArchiveRecordCreateManyInput {
  return {
    batchId,
    kind: "task",
    originalId: t.id,
    name: t.title,
    phone: client?.phone ?? null,
    status: taskState(t),
    owner: n.user(t.userId),
    at: t.dueAt,
    data: { ...taskData(t, n), client: client?.name ?? null, clientId: client?.id ?? null } as Prisma.InputJsonValue,
  };
}

/**
 * Moves every client, meeting and task, and every project except the ones kept, to a new archive batch.
 * The kept projects stay, empty. Users, work hours, settings and intake keys stay as they are.
 */
export async function archiveAll(by: { id: string; name: string }, keepProjectIds: string[]): Promise<{ batchId: string; counts: ArchiveCounts; kept: string[] }> {
  return prisma.$transaction(
    async (tx) => {
      // one query at a time: a transaction runs on a single connection
      const users = await tx.user.findMany({ select: { id: true, name: true } });
      const projects = await tx.project.findMany();
      const userName = new Map(users.map((u) => [u.id, u.name]));
      const projectName = new Map(projects.map((p) => [p.id, p.name]));
      const n: Names = { user: (id) => (id ? (userName.get(id) ?? null) : null), project: (id) => (id ? (projectName.get(id) ?? null) : null) };
      const keep = new Set(keepProjectIds.filter((id) => projectName.has(id)));
      const kept = projects.filter((p) => keep.has(p.id)).map((p) => p.name);
      const leaving = projects.filter((p) => !keep.has(p.id));

      const leadIds = (await tx.lead.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map((l) => l.id);
      const loose = await tx.meeting.findMany({ where: { leadId: null }, orderBy: { startAt: "asc" } });
      const looseTasks = await tx.task.findMany({ where: { leadId: null }, orderBy: { dueAt: "asc" } });
      const meetingIds = loose.map((m) => m.id);
      const taskIds = looseTasks.map((t) => t.id);
      const counts: ArchiveCounts = { leads: leadIds.length, meetings: 0, tasks: 0, projects: leaving.length };

      const batch = await tx.archiveBatch.create({ data: { byId: by.id, byName: by.name, kept, counts: {} } });
      let written = 0;
      // in steps of 500: thousands of imported meetings in one insert would pass PostgreSQL's limit on values per statement
      const write = async (rows: Prisma.ArchiveRecordCreateManyInput[]) => {
        for (const part of chunks(rows, 500)) written += (await tx.archiveRecord.createMany({ data: part })).count;
      };

      // clients, each with its whole story
      for (const ids of chunks(leadIds, CHUNK)) {
        // one query at a time (a transaction has a single connection), then each client gets its own rows
        const rows = await tx.lead.findMany({ where: { id: { in: ids } } });
        const activities = group(await tx.activity.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: "asc" } }));
        const inquiries = group(await tx.inquiry.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: "asc" } }));
        const meetings = group(await tx.meeting.findMany({ where: { leadId: { in: ids } }, orderBy: { startAt: "asc" } }));
        const tasks = group(await tx.task.findMany({ where: { leadId: { in: ids } }, orderBy: { dueAt: "asc" } }));
        const assignments = group(await tx.leadAssignment.findMany({ where: { leadId: { in: ids } }, orderBy: { at: "asc" } }));
        const leads = rows.map((l) => ({ ...l, activities: activities(l.id), inquiries: inquiries(l.id), meetings: meetings(l.id), tasks: tasks(l.id), assignments: assignments(l.id) }));
        // each meeting and task of a client is also found on its own, in the archive's meetings and tasks
        await write(
          leads.flatMap((l) => [
            ...l.meetings.map((m) => meetingRecord(batch.id, m, n, { id: l.id, name: l.name, phone: l.phone })),
            ...l.tasks.map((t) => taskRecord(batch.id, t, n, { id: l.id, name: l.name, phone: l.phone })),
          ]),
        );
        await write(
          leads.map((l) => {
            meetingIds.push(...l.meetings.map((m) => m.id));
            taskIds.push(...l.tasks.map((t) => t.id));
            return {
              batchId: batch.id,
              kind: "lead",
              originalId: l.id,
              name: l.name,
              phone: l.phone,
              project: n.project(l.projectId),
              status: l.status,
              owner: n.user(l.ownerId),
              at: l.createdAt,
              data: {
                email: l.email,
                source: l.source,
                lostReason: l.lostReason,
                attempts: l.attempts,
                nextAt: iso(l.nextAt),
                closedAt: iso(l.closedAt),
                consent: l.consent,
                createdBy: n.user(l.createdById),
                lastActivityAt: iso(l.lastActivityAt),
                activities: l.activities.map((a) => ({ at: iso(a.createdAt), kind: a.kind, direction: a.direction, text: a.text, by: n.user(a.userId), auto: a.auto, tags: a.tags, file: a.file })),
                inquiries: l.inquiries.map((q) => ({ at: iso(q.createdAt), source: q.source, project: n.project(q.projectId), campaign: q.campaign, page: q.page, payload: q.payload })),
                meetings: l.meetings.map((m) => meetingData(m, n)),
                tasks: l.tasks.map((t) => taskData(t, n)),
                assignments: l.assignments.map((a) => ({ at: iso(a.at), to: n.user(a.userId), by: n.user(a.byId) })),
              } as Prisma.InputJsonValue,
            };
          }),
        );
      }
      // meetings and tasks that belong to no client
      await write(loose.map((m) => meetingRecord(batch.id, m, n)));
      await write(looseTasks.map((t) => taskRecord(batch.id, t, n)));
      // the projects that leave
      await write(
        leaving.map((p) => ({
          batchId: batch.id,
          kind: "project",
          originalId: p.id,
          name: p.name,
          project: p.name,
          status: p.active ? "active" : "closed",
          at: p.createdAt,
          data: { fullName: p.fullName, place: p.place, active: p.active, sortOrder: p.sortOrder } as Prisma.InputJsonValue,
        })),
      );
      counts.meetings = meetingIds.length;
      counts.tasks = taskIds.length;
      // every copy is in place before anything is removed
      if (written !== leadIds.length + meetingIds.length + taskIds.length + leaving.length) throw new Error("archive: not every record was copied");
      await tx.archiveBatch.update({ where: { id: batch.id }, data: { counts } });

      for (const ids of chunks(taskIds, 5000)) await tx.task.deleteMany({ where: { id: { in: ids } } });
      for (const ids of chunks(meetingIds, 5000)) await tx.meeting.deleteMany({ where: { id: { in: ids } } });
      // a client's history, inquiries and assignments go with it
      for (const ids of chunks(leadIds, 5000)) await tx.lead.deleteMany({ where: { id: { in: ids } } });
      // undo can't bring back what moved to the archive
      await tx.actionLog.deleteMany({});
      const gone = leaving.map((p) => p.id);
      if (gone.length) {
        // anything that came in meanwhile keeps its place in the system, just without the project
        await tx.lead.updateMany({ where: { projectId: { in: gone } }, data: { projectId: null } });
        await tx.meeting.updateMany({ where: { projectId: { in: gone } }, data: { projectId: null } });
        await tx.inquiry.updateMany({ where: { projectId: { in: gone } }, data: { projectId: null } });
        await tx.apiKey.updateMany({ where: { projectId: { in: gone } }, data: { projectId: null } });
        await tx.project.deleteMany({ where: { id: { in: gone } } });
      }
      return { batchId: batch.id, counts, kept };
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
}

/** A client who comes back: the newest archived record with the same phone, for the system administrators. */
export async function archivedClient(phone: string): Promise<{ id: string; at: Date } | null> {
  const r = await prisma.archiveRecord.findFirst({ where: { kind: "lead", phone }, orderBy: { at: "desc" }, select: { id: true, at: true } });
  return r;
}
