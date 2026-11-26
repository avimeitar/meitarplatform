// Sources by number, the way lead suppliers who worked with Fireberry send them ("originatingleadcode": 138).
// A number nobody named yet still brings its leads in, under "<the key's source> (קוד 138)"; once a manager names it,
// those leads take the name (and the project, if they have none), and the next ones come in named.
import { prisma } from "./db";

export const placeholderSource = (keySource: string, code: string) => `${keySource.slice(0, 40)} (קוד ${code})`;
const placeholderEnd = (code: string) => ` (קוד ${code})`;

/** The name and project a number stands for, and a note that it was seen. */
export async function sourceForCode(code: string, keyName: string): Promise<{ source: string | null; projectId: string | null }> {
  const row = await prisma.sourceCode.upsert({
    where: { code },
    create: { code, seen: 1, lastAt: new Date(), lastKey: keyName },
    update: { seen: { increment: 1 }, lastAt: new Date(), lastKey: keyName },
  });
  const projectId = row.projectId && (await prisma.project.count({ where: { id: row.projectId } })) ? row.projectId : null;
  return { source: row.source, projectId };
}

/** Names a number. Leads that already came with it take the name, and the project when they have none. */
export async function nameSourceCode(code: string, source: string, projectId: string | null): Promise<number> {
  await prisma.sourceCode.upsert({ where: { code }, create: { code, source, projectId }, update: { source, projectId } });
  const waiting = { source: { endsWith: placeholderEnd(code) } };
  const leads = await prisma.lead.findMany({ where: waiting, select: { id: true } });
  await prisma.$transaction([
    prisma.lead.updateMany({ where: waiting, data: { source } }),
    prisma.inquiry.updateMany({ where: waiting, data: { source } }),
    ...(projectId ? [prisma.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) }, projectId: null }, data: { projectId } })] : []),
  ]);
  return leads.length;
}
