"use server";

import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { prisma } from "@/lib/db";
import { isPushEndpoint, sendToUser, vapid } from "@/lib/push";
import { ActionError, requireActionUser } from "@/lib/session";
import { headers } from "next/headers";

/** The public key the browser needs to subscribe. */
export async function pushKeyAction(): Promise<ActionResult<{ key: string }>> {
  return run(async () => {
    await requireActionUser();
    return { data: { key: (await vapid()).publicKey } };
  });
}

const subscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
});

/** This phone or browser gets reminders from now on. A shared device moves to whoever turned it on last. */
export async function savePushAction(input: z.input<typeof subscription>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const s = subscription.parse(input);
    if (!isPushEndpoint(s.endpoint)) throw new ActionError("הדפדפן הזה לא נתמך להתראות");
    const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint: s.endpoint },
      create: { userId: u.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent },
      update: { userId: u.id, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent },
    });
    return { message: "ההתראות הופעלו בטלפון הזה" };
  });
}

export async function removePushAction(endpoint: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    await prisma.pushSubscription.deleteMany({ where: { endpoint: String(endpoint), userId: u.id } });
    return { message: "ההתראות כובו בטלפון הזה" };
  });
}

/** A test notification to the person's own devices, to see that it works. */
export async function testPushAction(): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const n = await sendToUser(u.id, { title: "ההתראות פועלות", body: "כך תופיע תזכורת כשמגיע הזמן של משימה.", url: "/tasks", tag: "test" });
    if (!n) throw new ActionError("לא הצלחנו לשלוח. אפשר לכבות ולהפעיל שוב את ההתראות");
    return { message: "נשלחה התראת בדיקה" };
  });
}
