"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { availableChannels } from "@/lib/otp";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";
import { LOCKED, applyRequireCode, isSystemAdminRole, setFlag } from "@/lib/settings";

async function requireSystemAdmin() {
  const u = await requireActionUser("users.manage");
  if (!u.permissions.includes("users.manage") || !u.permissions.includes("roles.manage")) throw new ActionError("רק מנהל מערכת יכול לשנות את זה");
  return u;
}

/** A code by SMS or WhatsApp at every sign-in, for everyone. */
export async function setRequireCodeAction(on: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireSystemAdmin();
    const value = on === true;
    if (value && availableChannels().length === 0) throw new ActionError("קודם צריך לחבר SMS או וואטסאפ, כדי שהקודים יגיעו לטלפון. ההוראות ב-docs/SETUP.md");
    await applyRequireCode(value);
    await audit({ actorId: u.id, actorName: u.name, action: "settings.require_code", meta: { on: value }, ip: await requestIp() });
    revalidatePath("/users");
    return { message: on ? "מעכשיו כל כניסה צריכה גם קוד לנייד" : "הכניסה עכשיו עם טלפון וסיסמה בלבד" };
  });
}

/** Closes sign-in for everyone except system administrators, and signs out whoever is inside. */
export async function setSignInLockAction(locked: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireSystemAdmin();
    const value = locked === true;
    await setFlag(LOCKED, value);
    let signedOut = 0;
    if (value) {
      const users = await prisma.user.findMany({ where: { deletedAt: null }, include: { role: true } });
      const others = users.filter((x) => !isSystemAdminRole(x.role)).map((x) => x.id);
      signedOut = (await prisma.session.deleteMany({ where: { userId: { in: others } } })).count;
    }
    await audit({ actorId: u.id, actorName: u.name, action: "settings.lock", meta: { locked: value, signedOut }, ip: await requestIp() });
    revalidatePath("/", "layout");
    return { message: value ? "הכניסה נעולה. רק מנהלי מערכת יכולים להיכנס, וכל השאר נותקו" : "הכניסה פתוחה לכל המשתמשים" };
  });
}
