"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { canGrant, isPermission, PERMISSIONS, rolePermissions, type Permission } from "@/lib/permissions";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

const roleSchema = z.object({
  name: z.string().trim().min(2, "צריך לתת שם לתפקיד").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(100),
});

function clean(perms: string[]): Permission[] {
  return [...new Set(perms.filter(isPermission))];
}

function refresh() {
  revalidatePath("/roles");
  revalidatePath("/users");
  revalidatePath("/", "layout");
}

/** Would this change leave the system without anyone who can manage users and permissions? */
async function wouldLockOut(roleId: string, next: Set<Permission>): Promise<boolean> {
  if (next.has("users.manage") && next.has("roles.manage")) return false;
  const users = await prisma.user.findMany({ where: { active: true, deletedAt: null }, include: { role: true } });
  return !users.some((x) => {
    const p = x.roleId === roleId ? next : rolePermissions(x.role);
    return p.has("users.manage") && p.has("roles.manage");
  });
}

export async function createRoleAction(input: z.input<typeof roleSchema>): Promise<ActionResult<{ roleId: string }>> {
  return run(async () => {
    const u = await requireActionUser("roles.manage");
    const d = roleSchema.parse(input);
    const perms = clean(d.permissions);
    if (!canGrant(new Set(u.permissions), new Set(perms))) throw new ActionError("אפשר לתת לתפקיד רק הרשאות שיש לך");
    if (await prisma.role.findUnique({ where: { name: d.name } })) throw new ActionError("כבר יש תפקיד בשם הזה", "name");
    const role = await prisma.role.create({ data: { name: d.name, description: d.description || null, permissions: perms } });
    await audit({ actorId: u.id, actorName: u.name, action: "role.create", targetType: "role", targetId: role.id, targetName: role.name, meta: { permissions: perms }, ip: await requestIp() });
    refresh();
    return { message: `התפקיד ״${role.name}״ נוצר`, data: { roleId: role.id } };
  });
}

export async function updateRoleAction(roleId: string, input: z.input<typeof roleSchema>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("roles.manage");
    const role = await prisma.role.findUnique({ where: { id: String(roleId) } });
    if (!role) throw new ActionError("התפקיד לא נמצא");
    const d = roleSchema.parse(input);
    const mine = new Set(u.permissions);
    if (!canGrant(mine, rolePermissions(role))) throw new ActionError("אי אפשר לשנות תפקיד שיש לו הרשאות שאין לך");
    const before = rolePermissions(role);
    const next = role.locked ? before : new Set(clean(d.permissions));
    const added = [...next].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !next.has(p));
    if (!canGrant(mine, new Set(added))) throw new ActionError("אפשר להוסיף לתפקיד רק הרשאות שיש לך");
    if (!role.locked && removed.length && (await wouldLockOut(role.id, next))) throw new ActionError("השינוי הזה ישאיר את המערכת בלי אף אחד שיכול לנהל משתמשים והרשאות");
    const dup = await prisma.role.findFirst({ where: { name: d.name, id: { not: role.id } } });
    if (dup) throw new ActionError("כבר יש תפקיד בשם הזה", "name");
    await prisma.role.update({ where: { id: role.id }, data: { name: d.name, description: d.description || null, ...(role.locked ? {} : { permissions: [...next] }) } });
    await audit({
      actorId: u.id,
      actorName: u.name,
      action: "role.update",
      targetType: "role",
      targetId: role.id,
      targetName: d.name,
      meta: { added: added.map((p) => PERMISSIONS[p].label), removed: removed.map((p) => PERMISSIONS[p].label) },
      ip: await requestIp(),
    });
    refresh();
    return { message: added.length || removed.length ? `ההרשאות של ״${d.name}״ עודכנו` : "הפרטים נשמרו" };
  });
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("roles.manage");
    const role = await prisma.role.findUnique({ where: { id: String(roleId) }, include: { _count: { select: { users: { where: { deletedAt: null } } } } } });
    if (!role) throw new ActionError("התפקיד לא נמצא");
    if (role.builtIn) throw new ActionError("אי אפשר למחוק תפקיד מובנה. אפשר לשנות את ההרשאות שלו.");
    if (role._count.users > 0) throw new ActionError(`יש ${role._count.users} משתמשים בתפקיד הזה. צריך להעביר אותם לתפקיד אחר קודם`);
    await prisma.role.delete({ where: { id: role.id } });
    await audit({ actorId: u.id, actorName: u.name, action: "role.delete", targetType: "role", targetId: role.id, targetName: role.name, ip: await requestIp() });
    refresh();
    return { message: `התפקיד ״${role.name}״ נמחק` };
  });
}

