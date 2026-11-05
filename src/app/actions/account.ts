"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { prisma } from "@/lib/db";
import { parseChannel } from "@/lib/otp";
import { ActionError, requireActionUser } from "@/lib/session";

export async function setMyChannelAction(channel: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const ch = parseChannel(channel);
    if (!ch) throw new ActionError("צריך לבחור SMS או וואטסאפ");
    await prisma.user.update({ where: { id: u.id }, data: { otpChannel: ch } });
    revalidatePath("/account");
    return { message: ch === "sms" ? "מעכשיו הקוד יגיע ב-SMS" : "מעכשיו הקוד יגיע בוואטסאפ" };
  });
}
