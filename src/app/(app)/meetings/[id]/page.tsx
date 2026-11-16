import { notFound, redirect } from "next/navigation";
import { meetingClient } from "@/lib/crm/constants";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, requirePageUser } from "@/lib/session";
import { MeetingCard, type MeetingCardData } from "./MeetingCard";

export const metadata = { title: "כרטיס פגישה" };

/** A meeting as an entity of its own: its time, status, description, who set it, who meets, and the client. */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePageUser();
  const { id } = await params;
  const m = await prisma.meeting.findUnique({
    where: { id },
    include: {
      lead: { select: { id: true, name: true, phone: true, email: true, source: true, status: true, ownerId: true, owner: { select: { name: true } } } },
      project: { select: { id: true, name: true } },
      setBy: { select: { name: true } },
      host: { select: { id: true, name: true } },
    },
  });
  if (!m) notFound();
  const mine = m.setById === u.id || m.hostId === u.id || m.lead?.ownerId === u.id;
  if (!mine && !can(u, "leads.view_all")) redirect("/denied");
  const canEdit = can(u, "leads.edit") && (mine || can(u, "meetings.manage_all"));

  const [people, projects, history] = await Promise.all([
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    m.leadId ? prisma.activity.findMany({ where: { leadId: m.leadId, kind: "meeting" }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);

  const data: MeetingCardData = {
    id: m.id,
    startAt: m.startAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    place: m.place,
    status: m.status,
    confirmed: m.confirmed,
    note: m.note ?? "",
    subject: m.subject ?? "",
    source: m.lead?.source ?? m.source ?? "",
    setByName: m.setBy?.name ?? m.repName ?? null,
    host: m.host ? { id: m.host.id, name: m.host.name } : null,
    project: m.project ? { id: m.project.id, name: m.project.name } : null,
    client: {
      name: meetingClient(m),
      leadId: m.leadId,
      phone: m.lead ? formatPhone(m.lead.phone) : "",
      phoneRaw: m.lead?.phone ?? "",
      email: m.lead?.email ?? "",
      status: m.lead?.status ?? null,
      ownerName: m.lead?.owner?.name ?? null,
    },
    history: history.map((a) => ({ id: a.id, text: a.text, at: a.createdAt.toISOString(), by: a.user?.name ?? null })),
    canEdit,
  };
  return <MeetingCard m={data} people={people} projects={projects} />;
}
