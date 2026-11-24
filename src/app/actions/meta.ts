"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { metaConfig, openToken, unsubscribePage } from "@/lib/meta";
import { createInvite } from "@/lib/metaInvites";
import { pullAll } from "@/lib/metaLeads";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

const refresh = () => revalidatePath("/intake");

/** Which project a form's leads go to. */
export async function setFormProjectAction(formId: string, projectId: string | null): Promise<ActionResult> {
  return run(async () => {
    await requireActionUser("settings.manage");
    const form = await prisma.metaForm.findUnique({ where: { id: String(formId) } });
    if (!form) throw new ActionError("הטופס לא נמצא");
    if (projectId && !(await prisma.project.count({ where: { id: projectId } }))) throw new ActionError("הפרויקט לא נמצא");
    await prisma.metaForm.update({ where: { id: form.id }, data: { projectId: projectId || null } });
    refresh();
    return { message: projectId ? `לידים מ״${form.name}״ ייכנסו לפרויקט שנבחר` : `לידים מ״${form.name}״ ייכנסו בלי פרויקט קבוע` };
  });
}

/** Stops a page's leads from coming in. */
export async function disconnectPageAction(pageId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("settings.manage");
    const page = await prisma.metaPage.findUnique({ where: { id: String(pageId) } });
    if (!page) throw new ActionError("העמוד לא נמצא");
    const cfg = metaConfig();
    if (cfg) await unsubscribePage(cfg, page.id, openToken(page.token)).catch(() => {});
    await prisma.metaPage.update({ where: { id: page.id }, data: { active: false } });
    await audit({ actorId: u.id, actorName: u.name, action: "meta.disconnect", meta: { pages: page.name }, ip: await requestIp() });
    refresh();
    return { message: `העמוד ״${page.name}״ נותק. לידים ממנו כבר לא ייכנסו` };
  });
}

/** Brings in leads from the last 90 days that are not in the system yet (each lead is taken once). */
export async function pullMetaLeadsAction(): Promise<ActionResult> {
  return run(async () => {
    await requireActionUser("settings.manage");
    if (!metaConfig()) throw new ActionError("החיבור לפייסבוק עוד לא הוגדר");
    const r = await pullAll(() => new Date(Date.now() - 90 * 86_400_000));
    refresh();
    revalidatePath("/leads");
    const parts = [`${r.created} לקוחות חדשים`, `${r.merged} פניות לקוחות קיימים`];
    if (r.failed) parts.push(`${r.failed} עמודים לא הצליחו (הסיבה מופיעה ליד העמוד)`);
    return { message: `נמשכו הלידים מ-90 הימים האחרונים: ${parts.join(", ")}` };
  });
}

const inviteSchema = z.object({
  supplier: z.string().trim().min(2, "צריך לכתוב את שם הספק").max(80, "השם ארוך מדי"),
  source: z.string().trim().min(2, "צריך לכתוב מקור").max(60, "המקור ארוך מדי"),
  projectId: z.string().trim().max(60).optional().nullable(),
});

/** A link for a lead supplier to connect their own Facebook page. It is shown once. */
export async function createMetaInviteAction(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ link: string }>> {
  return run(async () => {
    const u = await requireActionUser("settings.manage");
    const d = inviteSchema.parse(input);
    if (d.projectId && !(await prisma.project.count({ where: { id: d.projectId } }))) throw new ActionError("הפרויקט לא נמצא", "projectId");
    const inv = await createInvite({ supplier: d.supplier, source: d.source, projectId: d.projectId || null, byId: u.id });
    await audit({ actorId: u.id, actorName: u.name, action: "meta.invite", targetName: d.supplier, meta: { source: d.source }, ip: await requestIp() });
    refresh();
    return { message: `נוצר קישור חיבור ל${d.supplier}`, data: { link: inv.link } };
  });
}

export async function revokeMetaInviteAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireActionUser("settings.manage");
    await prisma.metaInvite.update({ where: { id: String(id) }, data: { revokedAt: new Date() } });
    refresh();
    return { message: "הקישור בוטל" };
  });
}
