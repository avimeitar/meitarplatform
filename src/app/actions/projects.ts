"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const projectSchema = z.object({
  name: z.string().transform(oneLine).pipe(z.string().min(2, "צריך לכתוב שם קצר לפרויקט").max(40, "השם הקצר ארוך מדי. אפשר עד 40 תווים")),
  fullName: z
    .string()
    .optional()
    .transform((v) => oneLine(v ?? ""))
    .pipe(z.string().max(80, "השם המלא ארוך מדי. אפשר עד 80 תווים")),
  place: z.string().transform(oneLine).pipe(z.string().min(2, "צריך לכתוב איפה הפרויקט").max(60, "המקום ארוך מדי. אפשר עד 60 תווים")),
});

export type ProjectInput = z.input<typeof projectSchema>;

const TAKEN = "כבר יש פרויקט בשם הזה";

function refresh() {
  // projects appear in the new-lead form, the reports and the lead screens
  revalidatePath("/", "layout");
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const other = await prisma.project.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  return !!other;
}

/** Two people saving the same name at the same moment: the database refuses the second one. */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "P2002";
}

async function projectFor(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: String(projectId) } });
  if (!p) throw new ActionError("הפרויקט לא נמצא. אולי מישהו אחר שינה אותו");
  return p;
}

export async function createProjectAction(input: ProjectInput): Promise<ActionResult<{ projectId: string }>> {
  return run(async () => {
    const u = await requireActionUser("projects.manage");
    const d = projectSchema.parse(input);
    if (await nameTaken(d.name)) throw new ActionError(TAKEN, "name");
    const last = await prisma.project.aggregate({ _max: { sortOrder: true } });
    const data = { name: d.name, fullName: d.fullName || d.name, place: d.place, sortOrder: (last._max.sortOrder ?? -1) + 1 };
    const p = await prisma.project.create({ data }).catch((err: unknown) => {
      if (isUniqueViolation(err)) throw new ActionError(TAKEN, "name");
      throw err;
    });
    await audit({ actorId: u.id, actorName: u.name, action: "project.create", targetType: "project", targetId: p.id, targetName: p.name, meta: { fullName: p.fullName, place: p.place }, ip: await requestIp() });
    refresh();
    return { message: `הפרויקט ״${p.name}״ נוסף`, data: { projectId: p.id } };
  });
}

export async function updateProjectAction(projectId: string, input: ProjectInput): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("projects.manage");
    const p = await projectFor(projectId);
    const d = projectSchema.parse(input);
    const next = { name: d.name, fullName: d.fullName || d.name, place: d.place };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== p[k]);
    if (!changed.length) return { message: "הפרטים נשמרו" };
    if (next.name !== p.name && (await nameTaken(next.name, p.id))) throw new ActionError(TAKEN, "name");
    await prisma.project.update({ where: { id: p.id }, data: next }).catch((err: unknown) => {
      if (isUniqueViolation(err)) throw new ActionError(TAKEN, "name");
      throw err;
    });
    await audit({
      actorId: u.id,
      actorName: u.name,
      action: "project.update",
      targetType: "project",
      targetId: p.id,
      targetName: next.name,
      meta: { changed, ...(next.name !== p.name ? { from: p.name, to: next.name } : {}) },
      ip: await requestIp(),
    });
    refresh();
    return { message: "הפרטים של הפרויקט נשמרו" };
  });
}

/** Deactivating hides a project from new leads and from the projects report. Its leads and deals stay as they are. */
export async function setProjectActiveAction(projectId: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("projects.manage");
    const p = await projectFor(projectId);
    const on = active === true;
    if (p.active === on) return { message: on ? "הפרויקט כבר פעיל" : "הפרויקט כבר לא פעיל" };
    if (!on && (await prisma.project.count({ where: { active: true, NOT: { id: p.id } } })) === 0) {
      throw new ActionError("חייב להישאר לפחות פרויקט פעיל אחד, כדי שאפשר יהיה להוסיף לידים");
    }
    await prisma.project.update({ where: { id: p.id }, data: { active: on } });
    await audit({
      actorId: u.id,
      actorName: u.name,
      action: "project.update",
      targetType: "project",
      targetId: p.id,
      targetName: p.name,
      meta: { from: on ? "לא פעיל" : "פעיל", to: on ? "פעיל" : "לא פעיל" },
      ip: await requestIp(),
    });
    refresh();
    return { message: on ? `הפרויקט ״${p.name}״ חזר לפעילות` : `הפרויקט ״${p.name}״ הושבת. אפשר להחזיר אותו מהרשימה ״פרויקטים לא פעילים״` };
  });
}
