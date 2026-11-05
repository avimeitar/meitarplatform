"use server";

import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { passwordProblem } from "@/lib/password";
import { formatPhone } from "@/lib/phone";
import { ActionError, requestIp } from "@/lib/session";
import { findValidInvite, revokeSessions, setUserPassword } from "@/lib/users";

export async function acceptInvite(token: string, password: string): Promise<ActionResult<{ phone: string }>> {
  return run(async () => {
    const inv = await findValidInvite(String(token));
    if (!inv) throw new ActionError("הקישור לא בתוקף. אפשר לבקש מהמנהל קישור חדש.");
    const problem = passwordProblem(String(password));
    if (problem) throw new ActionError(problem, "password");
    await setUserPassword(inv.userId, String(password));
    await prisma.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    // a new password signs out every other device
    await revokeSessions(inv.userId);
    await audit({ actorId: inv.userId, actorName: inv.user.name, action: "auth.password_set", meta: { purpose: inv.purpose }, ip: await requestIp() });
    return { data: { phone: formatPhone(inv.user.phoneNumber) } };
  });
}
