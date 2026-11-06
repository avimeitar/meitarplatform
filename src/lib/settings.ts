import { prisma } from "./db";
import { rolePermissions } from "./permissions";

// System-wide switches that the administrator controls from the users screen.
//   auth.requireCode  - a code by SMS/WhatsApp at every sign-in (off until the administrator turns it on)
//   auth.locked       - sign-in closed for everyone except system administrators

export const REQUIRE_CODE = "auth.requireCode";
export const LOCKED = "auth.locked";

export async function getFlag(key: string, fallback = false): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? row.value === true : fallback;
}

export async function setFlag(key: string, value: boolean): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export const requireCode = () => getFlag(REQUIRE_CODE, false);
export const signInLocked = () => getFlag(LOCKED, false);

/** System administrators can manage users and permissions; they can always sign in, even when sign-in is locked. */
export function isSystemAdminRole(role: { locked: boolean; permissions: string[] }): boolean {
  const p = rolePermissions(role);
  return p.has("users.manage") && p.has("roles.manage");
}

/** Turns the sign-in code on or off for everyone at once (Better Auth reads it from each user). */
export async function applyRequireCode(on: boolean): Promise<void> {
  await setFlag(REQUIRE_CODE, on);
  await prisma.user.updateMany({ data: { twoFactorEnabled: on } });
}
