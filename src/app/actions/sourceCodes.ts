"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";
import { nameSourceCode } from "@/lib/sourceCodes";

const schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, "מספר המקור יכול להכיל ספרות ואותיות באנגלית בלבד"),
  source: z.string().trim().min(2, "צריך לכתוב שם למקור").max(60, "השם ארוך מדי. עד 60 תווים"),
  projectId: z.string().trim().max(60).optional().nullable(),
});

/** Gives a source number its name and project; leads that already came with it take the name. */
export async function saveSourceCodeAction(input: z.input<typeof schema>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("settings.manage");
    const d = schema.parse(input);
    if (d.projectId && !(await prisma.project.count({ where: { id: d.projectId } }))) throw new ActionError("הפרויקט לא נמצא", "projectId");
    const renamed = await nameSourceCode(d.code, d.source, d.projectId || null);
    await audit({ actorId: u.id, actorName: u.name, action: "apikey.source_code", targetName: d.code, meta: { to: d.source }, ip: await requestIp() });
    revalidatePath("/intake");
    revalidatePath("/leads");
    return { message: `מספר ${d.code} נשמר בשם ״${d.source}״` + (renamed ? `. ${renamed === 1 ? "לקוח אחד שכבר הגיע עודכן" : `${renamed} לקוחות שכבר הגיעו עודכנו`}` : "") };
  });
}

export async function deleteSourceCodeAction(code: string): Promise<ActionResult> {
  return run(async () => {
    await requireActionUser("settings.manage");
    await prisma.sourceCode.delete({ where: { code: String(code) } }).catch(() => {});
    revalidatePath("/intake");
    return { message: `מספר ${code} הוסר. לקוחות שכבר הגיעו איתו נשארים עם השם שלהם` };
  });
}
