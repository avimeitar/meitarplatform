// The archive list's search and filters, shared by the screen and its export.
import type { Prisma } from "@/generated/prisma/client";
import { isArchiveKind, type ArchiveKind } from "@/lib/archive";

export type ArchiveParams = Record<string, string | undefined>;

export function archiveQuery(sp: ArchiveParams): { kind: ArchiveKind; q: string; project: string; where: Prisma.ArchiveRecordWhereInput } {
  const kind: ArchiveKind = isArchiveKind(sp.kind) ? sp.kind : "lead";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const project = (sp.project ?? "").trim().slice(0, 80);
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  const where: Prisma.ArchiveRecordWhereInput = {
    kind,
    ...(project ? { project } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] } : {}),
  };
  return { kind, q, project, where };
}
