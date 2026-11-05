import { appBaseURL } from "@/lib/auth";
import { fD, relTime } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { FIELD_DOCS, maskedKey } from "@/lib/intake";
import { requirePageUser } from "@/lib/session";
import { IntakeScreen, type KeyRow } from "./IntakeScreen";
import "./intake.css";

export const metadata = { title: "קליטת לידים" };

export default async function IntakePage() {
  await requirePageUser("settings.manage");
  const [keys, projects] = await Promise.all([
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, active: true } }),
  ]);
  const creatorIds = [...new Set(keys.map((k) => k.createdById).filter((id): id is string => !!id))];
  const creators = creatorIds.length ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const creatorName = new Map(creators.map((c) => [c.id, c.name]));
  // dates are written here, on the server, so the screen shows the same text it was rendered with
  const rows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    source: k.source,
    project: k.projectId ? (projectName.get(k.projectId) ?? null) : null,
    masked: maskedKey(k.prefix),
    created: `${fD(k.createdAt)}.${String(k.createdAt.getFullYear()).slice(2)}`,
    createdBy: k.createdById ? (creatorName.get(k.createdById) ?? null) : null,
    lastUsed: k.lastUsedAt ? relTime(k.lastUsedAt) : null,
    active: k.active,
  }));
  const open = projects.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  return <IntakeScreen keys={rows} projects={open} fields={FIELD_DOCS} endpoint={`${appBaseURL()}/api/v1/leads`} />;
}
