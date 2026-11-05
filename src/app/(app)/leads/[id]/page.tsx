import { notFound } from "next/navigation";
import { openTaskWhere, taskRow } from "@/lib/crm/views";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, requirePageUser } from "@/lib/session";
import { LeadCard, type LeadCardData } from "./LeadCard";

export const metadata = { title: "כרטיס ליד" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePageUser();
  const { id } = await params;
  const l = await prisma.lead.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 150, include: { user: { select: { name: true } } } },
      meetings: { orderBy: { startAt: "desc" }, include: { setBy: { select: { name: true } }, host: { select: { name: true } }, project: { select: { name: true } } } },
      _count: { select: { inquiries: true } },
    },
  });
  if (!l || (!can(u, "leads.view_all") && l.ownerId !== u.id)) notFound();
  const [tasks, projects, people] = await Promise.all([
    prisma.task.findMany({ where: openTaskWhere({ leadId: l.id }), orderBy: { dueAt: "asc" }, include: { user: { select: { name: true } }, lead: { select: { name: true } } } }),
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const data: LeadCardData = {
    id: l.id,
    name: l.name,
    phone: formatPhone(l.phone),
    phoneRaw: l.phone,
    email: l.email ?? "",
    source: l.source,
    projectId: l.project?.id ?? "",
    projectName: l.project?.name ?? "",
    status: l.status,
    lostReason: l.lostReason,
    ownerId: l.owner?.id ?? null,
    ownerName: l.owner?.name ?? null,
    attempts: l.attempts,
    nextAt: l.nextAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    inquiries: l._count.inquiries,
    consent: l.consent,
    activities: l.activities.map((a) => ({ id: a.id, kind: a.kind, direction: a.direction, text: a.text, auto: a.auto, tags: a.tags, userName: a.user?.name ?? null, createdAt: a.createdAt.toISOString() })),
    meetings: l.meetings.map((m) => ({
      id: m.id,
      startAt: m.startAt.toISOString(),
      place: m.place,
      status: m.status,
      confirmed: m.confirmed,
      projectName: m.project?.name ?? "",
      setByName: m.setBy?.name ?? null,
      hostName: m.host?.name ?? null,
      canEdit: m.setById === u.id || m.hostId === u.id || l.ownerId === u.id || can(u, "meetings.manage_all"),
    })),
    tasks: tasks.map(taskRow),
  };
  return (
    <LeadCard
      lead={data}
      projects={projects}
      people={people}
      perms={{ edit: can(u, "leads.edit"), assign: can(u, "leads.assign"), del: can(u, "leads.delete"), assignTasks: can(u, "tasks.assign") }}
      meId={u.id}
    />
  );
}
