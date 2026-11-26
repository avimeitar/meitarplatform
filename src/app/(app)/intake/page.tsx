import { appBaseURL } from "@/lib/auth";
import { fD, relTime } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { FIELD_DOCS, maskedKey } from "@/lib/intake";
import { metaConfig, metaUrls, metaVerifyToken } from "@/lib/meta";
import { MetaPanel } from "./MetaPanel";
import { SourceCodes } from "./SourceCodes";
import { requirePageUser } from "@/lib/session";
import { IntakeScreen, type KeyRow } from "./IntakeScreen";
import "./intake.css";

export const metadata = { title: "קליטת לידים" };

export default async function IntakePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageUser("settings.manage");
  const sp = await searchParams;
  const [keys, projects, pages, invites, codes] = await Promise.all([
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, active: true } }),
    prisma.metaPage.findMany({ orderBy: { connectedAt: "asc" }, include: { forms: { orderBy: { createdAt: "asc" } } } }),
    prisma.metaInvite.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    prisma.sourceCode.findMany(),
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
  const urls = metaUrls();
  const meta = (
    <MetaPanel
      d={{
        configured: !!metaConfig(),
        status: sp.meta ? { kind: sp.meta, pages: sp.pages, subscribed: sp.subscribed, why: sp.why?.slice(0, 200) } : null,
        setup: { ...urls, verifyToken: metaVerifyToken() },
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name,
          active: p.active,
          supplier: p.supplier,
          source: p.source,
          lastLead: p.lastLeadAt ? relTime(p.lastLeadAt) : null,
          lastError: p.lastError,
          forms: p.forms.map((f) => ({ id: f.id, name: f.name, projectId: f.projectId && projectName.has(f.projectId) ? f.projectId : null, leads: f.leads, lastLead: f.lastLeadAt ? relTime(f.lastLeadAt) : null })),
        })),
        invites: invites.map((i) => ({ id: i.id, supplier: i.supplier, source: i.source, project: i.projectId ? (projectName.get(i.projectId) ?? null) : null, expires: `${fD(i.expiresAt)}.${String(i.expiresAt.getFullYear()).slice(2)}`, used: !!i.usedAt })),
        projects: open,
      }}
    />
  );
  // numbers that still need a name first, newest first; then the named ones by number
  const codeRows = [...codes]
    .sort((a, b) => (a.source ? 1 : 0) - (b.source ? 1 : 0) || (a.source ? a.code.localeCompare(b.code, "en", { numeric: true }) : (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0)))
    .map((c) => ({ code: c.code, source: c.source, projectId: c.projectId && projectName.has(c.projectId) ? c.projectId : null, seen: c.seen, last: c.lastAt ? relTime(c.lastAt) : null, lastKey: c.lastKey }));
  return (
    <IntakeScreen
      keys={rows}
      projects={open}
      fields={FIELD_DOCS}
      endpoint={`${appBaseURL()}/api/v1/leads`}
      meta={meta}
      codes={<SourceCodes rows={codeRows} projects={open} />}
    />
  );
}
