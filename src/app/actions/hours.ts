"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { addDays, fT, sod } from "@/lib/crm/dates";
import { prisma, type Tx } from "@/lib/db";
import { canEditShift, EDIT_DAYS, hhmm, isMissingExit, MAX_SHIFT_HOURS, tracksHours } from "@/lib/hours";
import { finishRegistration, registrationOptions, signingOptions, verifySignature } from "@/lib/signing";
import { ActionError, can, requestIp, requireActionUser, type CurrentUser } from "@/lib/session";

type Options = Awaited<ReturnType<typeof signingOptions>>;

function refresh() {
  revalidatePath("/", "layout");
}

async function trackedUser(): Promise<CurrentUser> {
  const u = await requireActionUser();
  if (!tracksHours(u)) throw new ActionError("מנהלי מערכת לא מדווחים שעות");
  return u;
}

async function client() {
  const h = await headers();
  return { ip: await requestIp(), userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** One person's shifts change one at a time: two taps can't open two shifts. */
async function lockUser(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
}

// ---------------------------------------------------------------- setting up the phone

export async function setupOptionsAction(): Promise<ActionResult<Awaited<ReturnType<typeof registrationOptions>>>> {
  return run(async () => {
    const u = await trackedUser();
    const me = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { phoneNumber: true } });
    return { data: await registrationOptions({ id: u.id, name: u.name, phone: me.phoneNumber }) };
  });
}

export async function setupFinishAction(response: RegistrationResponseJSON): Promise<ActionResult> {
  return run(async () => {
    const u = await trackedUser();
    const c = await client();
    const device = await finishRegistration(u.id, response, c.userAgent);
    await audit({ actorId: u.id, actorName: u.name, action: "hours.device_added", targetType: "user", targetId: u.id, targetName: u.name, meta: { device: device.name }, ip: c.ip });
    refresh();
    return { message: "החתימה הוגדרה. מעכשיו כל כניסה ויציאה ממשמרת נחתמת בטלפון הזה" };
  });
}

export async function removeDeviceAction(deviceId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const d = await prisma.signDevice.findUnique({ where: { id: String(deviceId) }, include: { user: { select: { name: true } } } });
    if (!d || d.revokedAt) throw new ActionError("הטלפון לא נמצא");
    if (d.userId !== u.id && !can(u, "hours.manage")) throw new ActionError("אפשר להסיר רק טלפון שלך");
    await prisma.signDevice.update({ where: { id: d.id }, data: { revokedAt: new Date() } });
    await audit({ actorId: u.id, actorName: u.name, action: "hours.device_removed", targetType: "user", targetId: d.userId, targetName: d.user.name, meta: { device: d.name }, ip: await requestIp() });
    refresh();
    return { message: "הטלפון הוסר מהחתימה" };
  });
}

// ---------------------------------------------------------------- in and out

export async function clockOptionsAction(action: "in" | "out"): Promise<ActionResult<Options>> {
  return run(async () => {
    const u = await trackedUser();
    if (action !== "in" && action !== "out") throw new ActionError("פעולה לא מוכרת");
    const open = await prisma.workShift.findFirst({ where: { userId: u.id, endAt: null }, orderBy: { startAt: "desc" } });
    if (open && isMissingExit(open.startAt)) throw new ActionError(`המשמרת שהתחילה ב-${fT(open.startAt)} לא נסגרה. קודם משלימים את שעת היציאה שלה`, "missing");
    if (action === "in" && open) throw new ActionError("כבר נמצאים במשמרת");
    if (action === "out" && !open) throw new ActionError("אין משמרת פתוחה");
    return { data: await signingOptions(u.id, action, { action, shiftId: open?.id ?? null }) };
  });
}

export async function clockAction(action: "in" | "out", response: AuthenticationResponseJSON): Promise<ActionResult> {
  return run(async () => {
    const u = await trackedUser();
    if (action !== "in" && action !== "out") throw new ActionError("פעולה לא מוכרת");
    const signed = await verifySignature(u.id, action, response);
    const c = await client();
    const message = await prisma.$transaction(async (tx) => {
      await lockUser(tx, u.id);
      const now = new Date();
      const open = await tx.workShift.findFirst({ where: { userId: u.id, endAt: null }, orderBy: { startAt: "desc" } });
      const proof = { userId: u.id, action, deviceId: signed.deviceId, event: signed.event as never, response: signed.response as never, ip: c.ip, userAgent: c.userAgent };
      if (action === "in") {
        if (open) throw new ActionError("כבר נמצאים במשמרת");
        const shift = await tx.workShift.create({ data: { userId: u.id, startAt: now, startKind: "signed" } });
        await tx.shiftSignature.create({ data: { ...proof, shiftId: shift.id } });
        return `נכנסת למשמרת ב-${fT(now)}`;
      }
      if (!open) throw new ActionError("אין משמרת פתוחה");
      if (signed.event.shiftId !== open.id) throw new ActionError("החתימה שייכת למשמרת אחרת. אפשר לנסות שוב.");
      await tx.workShift.update({ where: { id: open.id }, data: { endAt: now, endKind: "signed" } });
      await tx.shiftSignature.create({ data: { ...proof, shiftId: open.id } });
      return `יצאת מהמשמרת ב-${fT(now)}. משך המשמרת: ${hhmm(Math.round((now.getTime() - open.startAt.getTime()) / 60_000))} שעות`;
    });
    refresh();
    return { message };
  });
}

// ---------------------------------------------------------------- corrections

const correctionSchema = z.object({
  shiftId: z.string().optional(),
  // a manager adding a shift someone forgot
  userId: z.string().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "צריך לבחור יום"),
  start: z.string().regex(/^\d{1,2}:\d{2}$/, "צריך שעת כניסה"),
  end: z.string().regex(/^\d{1,2}:\d{2}$/, "צריך שעת יציאה"),
  reason: z.string().trim().min(3, "צריך לכתוב למה מתקנים").max(300),
});
type Correction = z.infer<typeof correctionSchema>;

/** Turns the form into times, and checks them. A shift that ends past midnight ends the next day. */
async function planCorrection(u: CurrentUser, input: Correction) {
  const shift = input.shiftId ? await prisma.workShift.findUnique({ where: { id: input.shiftId } }) : null;
  if (input.shiftId && !shift) throw new ActionError("המשמרת לא נמצאה");
  const targetId = shift?.userId ?? (input.userId && input.userId !== u.id ? input.userId : u.id);
  if (targetId !== u.id && !can(u, "hours.manage")) throw new ActionError("אפשר לתקן רק שעות שלך");
  if (targetId === u.id && !tracksHours(u)) throw new ActionError("מנהלי מערכת לא מדווחים שעות");
  const [y, mo, d] = input.day.split("-").map(Number);
  const [sh, sm] = input.start.split(":").map(Number);
  const [eh, em] = input.end.split(":").map(Number);
  const startAt = new Date(y, mo - 1, d, sh, sm);
  let endAt = new Date(y, mo - 1, d, eh, em);
  if (endAt <= startAt) endAt = addDays(endAt, 1);
  const now = new Date();
  if (Number.isNaN(startAt.getTime()) || sh > 23 || eh > 23 || sm > 59 || em > 59) throw new ActionError("השעה לא תקינה");
  if (endAt > now) throw new ActionError("אי אפשר לרשום שעות שעוד לא עברו");
  if (endAt.getTime() - startAt.getTime() > MAX_SHIFT_HOURS * 3_600_000) throw new ActionError(`משמרת לא יכולה להיות ארוכה מ-${MAX_SHIFT_HOURS} שעות`);
  const self = targetId === u.id;
  const limit = addDays(sod(now), -EDIT_DAYS);
  if (self && (startAt < limit || (shift && !canEditShift(u, shift, now)))) throw new ActionError(`אפשר לתקן שעות רק ${EDIT_DAYS} ימים אחורה. לתיקון ישן יותר פונים להנהלה`);
  if (shift && !self && !canEditShift(u, shift, now)) throw new ActionError("אין לך הרשאה לתקן את המשמרת הזו");
  const overlap = await prisma.workShift.findFirst({
    where: { userId: targetId, id: shift ? { not: shift.id } : undefined, startAt: { lt: endAt }, OR: [{ endAt: { gt: startAt } }, { endAt: null }] },
  });
  if (overlap) throw new ActionError(`השעות נופלות על משמרת אחרת שמתחילה ב-${fT(overlap.startAt)}`);
  return { shift, targetId, startAt, endAt, self };
}

/** The person's own correction is signed on their phone: first the options for that signature. */
export async function correctionOptionsAction(input: z.input<typeof correctionSchema>): Promise<ActionResult<Options>> {
  return run(async () => {
    const u = await requireActionUser();
    const data = correctionSchema.parse(input);
    const plan = await planCorrection(u, data);
    if (!plan.self) throw new ActionError("תיקון שעות של מישהו אחר לא צריך חתימה");
    return { data: await signingOptions(u.id, "edit", { action: "edit", ...data, startAt: plan.startAt.toISOString(), endAt: plan.endAt.toISOString() }) };
  });
}

export async function correctAction(input: z.input<typeof correctionSchema>, response?: AuthenticationResponseJSON): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const data = correctionSchema.parse(input);
    const plan = await planCorrection(u, data);
    let proof: { deviceId: string; event: Record<string, unknown>; response: unknown } | null = null;
    if (plan.self) {
      if (!response) throw new ActionError("צריך לחתום על התיקון בטלפון");
      proof = await verifySignature(u.id, "edit", response);
      // the signature must be over exactly these times and this reason
      const ev = proof.event;
      if (ev.shiftId !== (data.shiftId ?? undefined) || ev.day !== data.day || ev.start !== data.start || ev.end !== data.end || ev.reason !== data.reason) throw new ActionError("החתימה לא תואמת את התיקון. אפשר לנסות שוב.");
    }
    const c = await client();
    const result = await prisma.$transaction(async (tx) => {
      await lockUser(tx, plan.targetId);
      const before = plan.shift ? { startAt: plan.shift.startAt.toISOString(), endAt: plan.shift.endAt?.toISOString() ?? null } : null;
      const after = { startAt: plan.startAt.toISOString(), endAt: plan.endAt.toISOString() };
      const shift = plan.shift
        ? await tx.workShift.update({
            where: { id: plan.shift.id },
            data: {
              startAt: plan.startAt,
              endAt: plan.endAt,
              startKind: plan.shift.startAt.getTime() === plan.startAt.getTime() ? plan.shift.startKind : "manual",
              endKind: plan.shift.endAt?.getTime() === plan.endAt.getTime() ? plan.shift.endKind : "manual",
            },
          })
        : await tx.workShift.create({ data: { userId: plan.targetId, startAt: plan.startAt, endAt: plan.endAt, startKind: "manual", endKind: "manual" } });
      await tx.shiftEdit.create({ data: { shiftId: shift.id, byId: u.id, byName: u.name, reason: data.reason, before: (before ?? {}) as never, after, signed: !!proof } });
      if (proof) await tx.shiftSignature.create({ data: { shiftId: shift.id, userId: u.id, action: "edit", deviceId: proof.deviceId, event: proof.event as never, response: proof.response as never, ip: c.ip, userAgent: c.userAgent } });
      return shift;
    });
    const target = plan.self ? u.name : ((await prisma.user.findUnique({ where: { id: plan.targetId }, select: { name: true } }))?.name ?? "");
    await audit({ actorId: u.id, actorName: u.name, action: "hours.corrected", targetType: "user", targetId: plan.targetId, targetName: target, meta: { shift: result.id, reason: data.reason, signed: !!proof }, ip: c.ip });
    refresh();
    return { message: plan.shift ? "השעות תוקנו. התיקון נשמר עם הסיבה" : "המשמרת נוספה. היא מסומנת כרישום ידני" };
  });
}
