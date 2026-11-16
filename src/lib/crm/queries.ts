import { prisma } from "@/lib/db";
import { shiftState, tracksHours } from "@/lib/hours";
import { getLists, toClient } from "@/lib/lists";
import { defaultMeetingHost } from "@/lib/settings";
import { can, type CurrentUser } from "@/lib/session";
import { addDays, sod } from "./dates";
import { buildQueue } from "./service";

export async function shellData(u: CurrentUser) {
  const today = sod(new Date());
  const tracked = tracksHours(u);
  const [queue, newLeads, meetingsToday, tasksDue, projects, people, shift, meetingHost, lists] = await Promise.all([
    buildQueue(u.id),
    prisma.lead.count({ where: { status: "new", ...(can(u, "leads.view_all") ? {} : { ownerId: u.id }) } }),
    prisma.meeting.count({ where: { status: { notIn: ["cancel", "resched"] }, startAt: { gte: today, lt: addDays(today, 1) }, ...(can(u, "reports.view") ? {} : { OR: [{ setById: u.id }, { hostId: u.id }] }) } }),
    prisma.task.count({ where: { userId: u.id, done: false, dueAt: { lt: addDays(today, 1) } } }),
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tracked ? shiftState(u.id) : null,
    defaultMeetingHost(),
    getLists(),
  ]);
  const shiftInfo = {
    tracked,
    openSince: shift?.open && !shift.missingExit ? shift.open.startAt.toISOString() : null,
    missingExit: !!shift?.missingExit,
    hasDevice: !!shift?.hasDevice,
  };
  return { counts: { work: queue.length, leads: newLeads, meetings: meetingsToday, tasks: tasksDue }, projects, people, shift: shiftInfo, meetingHost, lists: toClient(lists) };
}
