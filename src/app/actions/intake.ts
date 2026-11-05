"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/intake";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

const keySchema = z.object({
  name: z.string().trim().min(2, "צריך לתת שם למפתח").max(80, "השם ארוך מדי"),
  source: z.string().trim().min(2, "צריך לכתוב מאיפה מגיעים הלידים").max(60, "המקור ארוך מדי. עד 60 תווים"),
  projectId: z.string().trim().max(60).optional().nullable(),
});

export type NewApiKey = { id: string; key: string; name: string; source: string; projectName: string | null };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** Creates a key for one outside system. The full key is returned only here, once: the database keeps its hash. */
export async function createApiKeyAction(input: z.input<typeof keySchema>): Promise<ActionResult<NewApiKey>> {
  return run(async () => {
    const u = await requireActionUser("settings.manage");
    const d = keySchema.parse(input);
    const project = d.projectId ? await prisma.project.findUnique({ where: { id: d.projectId }, select: { id: true, name: true } }) : null;
    if (d.projectId && !project) throw new ActionError("הפרויקט לא נמצא. אפשר לבחור פרויקט אחר", "projectId");
    let made: { row: { id: string; name: string; source: string; prefix: string }; key: string } | null = null;
    for (let attempt = 0; !made; attempt++) {
      const g = generateApiKey();
      try {
        const row = await prisma.apiKey.create({ data: { name: d.name, prefix: g.prefix, hash: g.hash, source: d.source, projectId: project?.id ?? null, createdById: u.id } });
        made = { row, key: g.key };
      } catch (err) {
        // a prefix that is already taken: draw a new key
        if (attempt >= 2 || !isUniqueViolation(err)) throw err;
      }
    }
    const { row, key } = made;
    await audit({
      actorId: u.id,
      actorName: u.name,
      action: "apikey.create",
      targetType: "apikey",
      targetId: row.id,
      targetName: row.name,
      meta: { source: row.source, project: project?.name ?? null, prefix: row.prefix },
      ip: await requestIp(),
    });
    revalidatePath("/intake");
    return { message: `המפתח ״${row.name}״ נוצר`, data: { id: row.id, key, name: row.name, source: row.source, projectName: project?.name ?? null } };
  });
}

/** Stops a key at once. A revoked key cannot be turned back on: a new key is created instead. */
export async function revokeApiKeyAction(keyId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("settings.manage");
    const key = await prisma.apiKey.findUnique({ where: { id: String(keyId) } });
    if (!key) throw new ActionError("המפתח לא נמצא");
    const changed = await prisma.apiKey.updateMany({ where: { id: key.id, active: true }, data: { active: false } });
    if (!changed.count) throw new ActionError("המפתח הזה כבר בוטל");
    await audit({
      actorId: u.id,
      actorName: u.name,
      action: "apikey.revoke",
      targetType: "apikey",
      targetId: key.id,
      targetName: key.name,
      meta: { source: key.source, prefix: key.prefix },
      ip: await requestIp(),
    });
    revalidatePath("/intake");
    return { message: `המפתח ״${key.name}״ בוטל. לידים שיישלחו איתו לא ייקלטו` };
  });
}
