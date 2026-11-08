"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { OPEN_STATUSES } from "@/lib/crm/constants";
import { autoOwnerPicker } from "@/lib/crm/service";
import { prisma } from "@/lib/db";
import { canGrant, rolePermissions } from "@/lib/permissions";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { ActionError, requestIp, requireActionUser, type CurrentUser } from "@/lib/session";
import { countActiveAdmins, createInviteLink, createUserRecord, inviteMessage, placeholderEmail, revokeSessions, sendInviteSms } from "@/lib/users";

const userSchema = z.object({
  name: z.string().trim().min(2, "צריך לכתוב שם מלא").max(120),
  phone: z.string().trim().min(1, "צריך לכתוב מספר נייד"),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  roleId: z.string().min(1, "צריך לבחור תפקיד"),
  autoAssign: z.boolean().optional(),
});

function refresh() {
  revalidatePath("/users");
  revalidatePath("/", "layout");
}

async function actorPerms(u: CurrentUser) {
  return new Set(u.permissions);
}

/** Loads a user the actor is allowed to manage: nobody can manage someone with permissions they don't have. */
async function manageable(u: CurrentUser, userId: string) {
  const target = await prisma.user.findUnique({ where: { id: String(userId) }, include: { role: true } });
  if (!target || target.deletedAt) throw new ActionError("המשתמש לא נמצא");
  if (!canGrant(await actorPerms(u), rolePermissions(target.role))) throw new ActionError("אי אפשר לנהל משתמש שיש לו הרשאות שאין לך");
  return target;
}

async function checkPhoneFree(phone: string, exceptId?: string) {
  const other = await prisma.user.findFirst({ where: { phoneNumber: phone, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (other) throw new ActionError("המספר הזה כבר שייך למשתמש אחר", "phone");
}

async function checkEmailFree(email: string, exceptId?: string) {
  const other = await prisma.user.findFirst({ where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (other) throw new ActionError("האימייל הזה כבר שייך למשתמש אחר", "email");
}

async function roleFor(u: CurrentUser, roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new ActionError("צריך לבחור תפקיד", "roleId");
  if (!canGrant(await actorPerms(u), rolePermissions(role))) throw new ActionError("אי אפשר לתת תפקיד עם הרשאות שאין לך", "roleId");
  return role;
}

export type InviteInfo = { url: string; smsSent: boolean; text: string; phone: string; waUrl: string };

async function issueLink(u: CurrentUser, user: { id: string; name: string; phoneNumber: string | null }, purpose: "invite" | "reset"): Promise<InviteInfo> {
  const link = await createInviteLink(user.id, purpose, u.id);
  const text = inviteMessage(user.name, link.url, purpose);
  let smsSent = false;
  if (user.phoneNumber) {
    try {
      smsSent = await sendInviteSms(user.phoneNumber, text);
    } catch {
      smsSent = false;
    }
  }
  await audit({ actorId: u.id, actorName: u.name, action: "user.invite", targetType: "user", targetId: user.id, targetName: user.name, meta: { purpose, smsSent }, ip: await requestIp() });
  const digits = (user.phoneNumber ?? "").replace(/\D/g, "");
  return { url: link.url, smsSent, text, phone: formatPhone(user.phoneNumber), waUrl: `https://wa.me/${digits}?text=${encodeURIComponent(text)}` };
}

export async function createUserAction(input: z.input<typeof userSchema>): Promise<ActionResult<{ userId: string; invite: InviteInfo }>> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const d = userSchema.parse(input);
    const phone = normalizePhone(d.phone);
    if (!phone) throw new ActionError("המספר לא נראה תקין. למשל 050-1234567", "phone");
    await checkPhoneFree(phone);
    const email = d.email ? d.email.toLowerCase() : "";
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("האימייל לא נראה תקין", "email");
      await checkEmailFree(email);
    }
    const role = await roleFor(u, d.roleId);
    const user = await createUserRecord({ name: d.name, phone, email: email || null, roleId: role.id, createdById: u.id });
    const autoAssign = d.autoAssign ?? role.key === "agent";
    if (autoAssign) await prisma.user.update({ where: { id: user.id }, data: { autoAssign: true } });
    await audit({ actorId: u.id, actorName: u.name, action: "user.create", targetType: "user", targetId: user.id, targetName: user.name, meta: { role: role.name }, ip: await requestIp() });
    const invite = await issueLink(u, user, "invite");
    refresh();
    return { message: `החשבון של ${user.name} נוצר`, data: { userId: user.id, invite } };
  });
}

export async function updateUserAction(userId: string, input: z.input<typeof userSchema>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const target = await manageable(u, userId);
    const d = userSchema.parse(input);
    const phone = normalizePhone(d.phone);
    if (!phone) throw new ActionError("המספר לא נראה תקין. למשל 050-1234567", "phone");
    await checkPhoneFree(phone, target.id);
    const email = d.email ? d.email.toLowerCase() : "";
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("האימייל לא נראה תקין", "email");
      await checkEmailFree(email, target.id);
    }
    const role = await roleFor(u, d.roleId);
    const losesAdmin = rolePermissions(target.role).has("users.manage") && rolePermissions(target.role).has("roles.manage") && !(rolePermissions(role).has("users.manage") && rolePermissions(role).has("roles.manage"));
    if (losesAdmin && target.active && (await countActiveAdmins(target.id)) === 0) throw new ActionError("חייב להישאר לפחות מנהל מערכת אחד", "roleId");
    const phoneChanged = phone !== target.phoneNumber;
    await prisma.user.update({
      where: { id: target.id },
      data: {
        name: d.name,
        phoneNumber: phone,
        email: email || (target.email.endsWith("@users.meitar.invalid") ? target.email : placeholderEmail(target.id)),
        roleId: role.id,
        autoAssign: d.autoAssign ?? target.autoAssign,
        ...(phoneChanged ? { phoneNumberVerified: false } : {}),
      },
    });
    // a new phone number means codes go somewhere else: sign the person out everywhere
    if (phoneChanged) await revokeSessions(target.id);
    const ip = await requestIp();
    if (role.id !== target.roleId) await audit({ actorId: u.id, actorName: u.name, action: "user.role", targetType: "user", targetId: target.id, targetName: d.name, meta: { from: target.role.name, to: role.name }, ip });
    await audit({ actorId: u.id, actorName: u.name, action: "user.update", targetType: "user", targetId: target.id, targetName: d.name, meta: { phoneChanged }, ip });
    refresh();
    return { message: phoneChanged ? "הפרטים נשמרו. מספר הנייד השתנה, ולכן המשתמש נותק וייכנס מחדש" : "הפרטים נשמרו" };
  });
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const target = await manageable(u, userId);
    const on = active === true; // only a real boolean, nothing else from the client
    if (target.id === u.id) throw new ActionError("אי אפשר להשבית את עצמך");
    if (!on && (await countActiveAdmins(target.id)) === 0) throw new ActionError("חייב להישאר לפחות מנהל מערכת פעיל אחד");
    await prisma.user.update({ where: { id: target.id }, data: { active: on, ...(on ? {} : { autoAssign: false }) } });
    if (!on) {
      await revokeSessions(target.id);
      // links sent before the account was paused don't work after it comes back
      await prisma.invite.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } });
    }
    await audit({ actorId: u.id, actorName: u.name, action: on ? "user.activate" : "user.deactivate", targetType: "user", targetId: target.id, targetName: target.name, ip: await requestIp() });
    refresh();
    return { message: on ? `החשבון של ${target.name} פעיל שוב` : `החשבון של ${target.name} הושבת ונותק מכל המכשירים` };
  });
}

/** Deletes a user: their open leads, tasks and future meetings go to someone else first. History keeps their name. */
export async function deleteUserAction(userId: string, reassignTo: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const target = await manageable(u, userId);
    if (target.id === u.id) throw new ActionError("אי אפשר למחוק את עצמך");
    if ((await countActiveAdmins(target.id)) === 0) throw new ActionError("חייב להישאר לפחות מנהל מערכת פעיל אחד");
    let heir: { id: string; name: string } | null = null;
    if (reassignTo !== "auto") {
      heir = await prisma.user.findFirst({ where: { id: reassignTo, active: true, deletedAt: null, NOT: { id: target.id } }, select: { id: true, name: true } });
      if (!heir) throw new ActionError("צריך לבחור למי להעביר את הלידים", "reassignTo");
    }
    const counts = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { autoAssign: false } });
      const leads = await tx.lead.findMany({ where: { ownerId: target.id, status: { in: OPEN_STATUSES } }, select: { id: true } });
      // with automatic distribution the leads are spread evenly, not all given to one person
      const pick = heir ? null : await autoOwnerPicker(tx);
      for (const l of leads) {
        const owner = heir ? heir.id : pick!();
        await tx.lead.update({ where: { id: l.id }, data: { ownerId: owner } });
        if (owner) await tx.leadAssignment.create({ data: { leadId: l.id, userId: owner, byId: u.id } });
        await tx.activity.create({ data: { leadId: l.id, kind: "status", text: `הליד הועבר אחרי שהחשבון של ${target.name} נמחק`, auto: "העברה אוטומטית במחיקת משתמש", userId: u.id } });
        await tx.task.updateMany({ where: { leadId: l.id, done: false, userId: target.id }, data: { userId: owner ?? u.id } });
      }
      const otherTasks = await tx.task.updateMany({ where: { userId: target.id, done: false }, data: { userId: heir?.id ?? u.id } });
      const future = await tx.meeting.updateMany({ where: { hostId: target.id, status: "set", startAt: { gte: new Date() } }, data: { hostId: heir?.id ?? u.id } });
      // the confirmation call before a meeting goes to whoever set it
      await tx.meeting.updateMany({ where: { setById: target.id, status: "set", startAt: { gte: new Date() } }, data: { setById: heir?.id ?? u.id } });
      await tx.user.update({
        where: { id: target.id },
        data: { active: false, deletedAt: new Date(), phoneNumber: null, email: `deleted-${target.id}@users.meitar.invalid`, autoAssign: false },
      });
      await tx.account.deleteMany({ where: { userId: target.id } });
      await tx.invite.deleteMany({ where: { userId: target.id } });
      return { leads: leads.length, tasks: otherTasks.count, meetings: future.count };
    }, { timeout: 180_000, maxWait: 10_000 });
    await revokeSessions(target.id);
    await audit({ actorId: u.id, actorName: u.name, action: "user.delete", targetType: "user", targetId: target.id, targetName: target.name, meta: { ...counts, to: heir?.name ?? "חלוקה אוטומטית" }, ip: await requestIp() });
    refresh();
    return { message: `החשבון של ${target.name} נמחק. ${counts.leads === 1 ? "ליד פתוח אחד הועבר" : counts.leads + " לידים פתוחים הועברו"} ל${heir?.name ?? "חלוקה האוטומטית"}` };
  });
}

export async function sendLinkAction(userId: string, purpose: "invite" | "reset"): Promise<ActionResult<InviteInfo>> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const target = await manageable(u, userId);
    if (!target.active) throw new ActionError("המשתמש מושבת. צריך להחזיר אותו לפעילות קודם");
    const info = await issueLink(u, target, purpose === "reset" ? "reset" : "invite");
    refresh();
    return { message: info.smsSent ? "הקישור נשלח ב-SMS" : "הקישור מוכן לשליחה", data: info };
  });
}

export async function revokeUserSessionsAction(userId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("users.manage");
    const target = await manageable(u, userId);
    const n = await revokeSessions(target.id);
    await audit({ actorId: u.id, actorName: u.name, action: "user.sessions_revoked", targetType: "user", targetId: target.id, targetName: target.name, meta: { sessions: n }, ip: await requestIp() });
    refresh();
    return { message: `החשבון של ${target.name} נותק מכל המכשירים` };
  });
}
