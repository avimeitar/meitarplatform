// Reminders on the phone (web push): the keys, sending, and the once-a-minute check for tasks that fall due.
// The keys are made once and kept in the database, so there is nothing to set up in Railway.
import webpush from "web-push";
import { appBaseURL } from "./auth";
import { prisma } from "./db";

const KEY = "push.vapid";
type Vapid = { publicKey: string; privateKey: string };
let cached: Vapid | null = null;

export async function vapid(): Promise<Vapid> {
  if (cached) return cached;
  const read = async () => (await prisma.setting.findUnique({ where: { key: KEY } }))?.value as Vapid | undefined;
  let v = await read();
  if (!v?.publicKey || !v?.privateKey) {
    // two servers starting together: whichever saved first wins, and both use it
    const keys = webpush.generateVAPIDKeys();
    await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: { publicKey: keys.publicKey, privateKey: keys.privateKey } }, update: {} });
    v = await read();
  }
  cached = v as Vapid;
  return cached;
}

/** Push services only accept these hosts; anything else is refused before it is stored (so the server never posts elsewhere). */
const PUSH_HOSTS = [".googleapis.com", ".mozilla.com", ".push.apple.com", ".notify.windows.com"];
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Sends to every phone and browser the person turned reminders on in. Returns how many got it. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return 0;
  const v = await vapid();
  const base = appBaseURL();
  const subject = base.startsWith("https://") ? base : "mailto:noreply@meitar.invalid";
  let sent = 0;
  for (const s of subs) {
    if (!isPushEndpoint(s.endpoint)) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject, publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 3600,
        urgency: "high",
      });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // the browser unsubscribed or the app was removed: forget it
      if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.error("[push] send failed", code ?? e);
    }
  }
  return sent;
}

/**
 * Tasks that just fell due, for people with reminders turned on. Each is marked as reminded in the same step,
 * so two servers never send the same reminder. Automatic "try again" reminders are left to the call queue.
 */
export async function claimDueTasks(now = new Date()) {
  const since = new Date(now.getTime() - 2 * 3_600_000);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Task" t SET "remindedAt" = now()
    WHERE t."done" = false AND t."remindedAt" IS NULL AND t."dueAt" <= ${now} AND t."dueAt" > ${since}
      AND (t."auto" IS NULL OR t."auto" <> 'retry')
      AND EXISTS (SELECT 1 FROM "PushSubscription" p WHERE p."userId" = t."userId")
    RETURNING t.id`;
  if (!claimed.length) return [];
  return prisma.task.findMany({ where: { id: { in: claimed.map((c) => c.id) } }, include: { lead: { select: { name: true } } } });
}

/** One reminder per task that just fell due, to the phones of the person it belongs to. */
export async function remindDueTasks(now = new Date()): Promise<number> {
  const tasks = await claimDueTasks(now);
  for (const t of tasks)
    await sendToUser(t.userId, {
      title: "הגיע הזמן למשימה",
      body: t.lead ? `${t.title} (${t.lead.name})` : t.title,
      url: t.leadId ? `/leads/${t.leadId}` : "/tasks",
      tag: `task-${t.id}`,
    });
  return tasks.length;
}

/** Started once when the server starts. */
export function startReminders() {
  const g = globalThis as { __meitarReminders?: ReturnType<typeof setInterval> };
  if (g.__meitarReminders) return;
  g.__meitarReminders = setInterval(() => {
    remindDueTasks().catch((e) => console.error("[push] reminders failed", e));
  }, 60_000);
}
