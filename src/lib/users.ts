import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appBaseURL, getAuth } from "./auth";
import { prisma } from "./db";
import { realProviderConnected, senderFor } from "./otp";
import { rolePermissions, type Permission } from "./permissions";
import { requireCode } from "./settings";

export const INVITE_HOURS = 72;
export const RESET_HOURS = 24;

export function placeholderEmail(id: string): string {
  // ".invalid" can never receive mail, so nothing is ever sent to these addresses.
  return `u-${id}@users.meitar.invalid`;
}

export function isPlaceholderEmail(e: string): boolean {
  return e.endsWith("@users.meitar.invalid");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const ctx = await getAuth().$context;
  return ctx.password.hash(password);
}

/** Sets (or replaces) the password people sign in with. */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const existing = await prisma.account.findFirst({ where: { userId, providerId: "credential" } });
  if (existing) await prisma.account.update({ where: { id: existing.id }, data: { password: hash } });
  else await prisma.account.create({ data: { id: randomUUID(), accountId: userId, providerId: "credential", userId, password: hash } });
}

export async function createUserRecord(input: { name: string; phone: string; email?: string | null; roleId: string; createdById?: string | null }) {
  const id = randomUUID();
  const code = await requireCode();
  return prisma.user.create({
    data: {
      id,
      name: input.name.trim(),
      phoneNumber: input.phone,
      email: input.email?.trim().toLowerCase() || placeholderEmail(id),
      roleId: input.roleId,
      createdById: input.createdById ?? null,
      twoFactorEnabled: code,
    },
  });
}

/** A one-time link to set a password: for new users, or when someone forgot theirs. Earlier unused links stop working. */
export async function createInviteLink(userId: string, purpose: "invite" | "reset", createdById: string | null) {
  const token = randomBytes(32).toString("base64url");
  const hours = purpose === "invite" ? INVITE_HOURS : RESET_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await prisma.invite.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.invite.create({ data: { userId, tokenHash: hashToken(token), purpose, expiresAt, createdById } });
  return { url: `${appBaseURL()}/invite/${token}`, expiresAt };
}

export async function findValidInvite(token: string) {
  if (!token || token.length < 20) return null;
  const inv = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) return null;
  if (!inv.user.active || inv.user.deletedAt) return null;
  return inv;
}

export function inviteMessage(name: string, url: string, purpose: "invite" | "reset"): string {
  const first = name.trim().split(/\s+/)[0];
  return purpose === "invite"
    ? `שלום ${first}, נפתח לך חשבון במערכת מיתר. כדי לקבוע סיסמה ולהיכנס: ${url}`
    : `שלום ${first}, זה הקישור לקביעת סיסמה חדשה במערכת מיתר: ${url}`;
}

/** Sends the link by SMS when an SMS provider is connected. Otherwise the manager shares it (copy or WhatsApp). */
export async function sendInviteSms(phone: string, text: string): Promise<boolean> {
  if (!realProviderConnected()) return false;
  const sms = senderFor("sms");
  if (!sms || sms.name === "console") return false;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return false;
  const form = new URLSearchParams({ To: phone, Body: text });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else if (process.env.TWILIO_SMS_FROM) form.set("From", process.env.TWILIO_SMS_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return res.ok;
}

export async function revokeSessions(userId: string): Promise<number> {
  const r = await prisma.session.deleteMany({ where: { userId } });
  // forget "trust this device" too, so the next sign-in asks for a code again
  await prisma.verification.deleteMany({ where: { value: userId, identifier: { startsWith: "trust-device-" } } });
  return r.count;
}

/** People who can manage users and permissions. The system must always keep at least one. */
export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  const users = await prisma.user.findMany({
    where: { active: true, deletedAt: null, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    include: { role: true },
  });
  return users.filter((u) => {
    const p = rolePermissions(u.role);
    return p.has("users.manage") && p.has("roles.manage");
  }).length;
}

export function permsOfRole(role: { locked: boolean; permissions: string[] }): Set<Permission> {
  return rolePermissions(role);
}
