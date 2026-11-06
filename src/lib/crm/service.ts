// CRM rules in one place. Every change goes through a Recorder so it can be undone from the toast.
import type { Tx } from "@/lib/db";
import { prisma } from "@/lib/db";
import type { Recorder } from "@/lib/undo";
import { meetingClient, MS, ST, type LeadStatus, type MeetingStatus } from "./constants";
import { HOUR, WD, addDays, at, fD, fT, nextWorkday, relTime, sameDay, sod } from "./dates";

type By = { id: string; name: string };

export async function addActivity(
  tx: Tx,
  rec: Recorder,
  leadId: string,
  a: { kind: string; text: string; direction?: string | null; file?: string | null; auto?: string | null; tags?: string[]; userId?: string | null },
) {
  const row = await tx.activity.create({ data: { leadId, kind: a.kind, text: a.text, direction: a.direction ?? null, file: a.file ?? null, auto: a.auto ?? null, tags: a.tags ?? [], userId: a.userId ?? null } });
  rec.created("activity", row.id);
  await rec.before("lead", leadId, ["lastActivityAt"]);
  await tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: new Date() } });
  return row;
}

export async function addTask(tx: Tx, rec: Recorder, t: { leadId?: string | null; userId: string; title: string; dueAt: Date; auto?: string | null; createdById?: string | null }) {
  const row = await tx.task.create({ data: { leadId: t.leadId ?? null, userId: t.userId, title: t.title, dueAt: t.dueAt, auto: t.auto ?? null, createdById: t.createdById ?? null } });
  rec.created("task", row.id);
  return row;
}

export async function setLeadStatus(tx: Tx, rec: Recorder, leadId: string, st: LeadStatus, by: string | null, opts: { auto?: string; reason?: string | null } = {}) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const reason = st === "lost" ? (opts.reason ?? lead.lostReason) : null;
  if (lead.status === st && (st !== "lost" || reason === lead.lostReason)) return;
  await rec.before("lead", leadId, ["status", "lostReason", "closedAt"]);
  await tx.lead.update({
    where: { id: leadId },
    data: { status: st, lostReason: reason, closedAt: st === "won" ? new Date() : lead.status === "won" ? null : lead.closedAt },
  });
  const from = ST[lead.status as LeadStatus]?.l ?? lead.status;
  await addActivity(tx, rec, leadId, {
    kind: "status",
    text: `הסטטוס השתנה מ״${from}״ ל״${ST[st].l}״` + (st === "lost" && reason ? `. סיבה: ${reason}` : ""),
    auto: opts.auto ?? null,
    userId: opts.auto ? null : by,
  });
}

async function setLead(tx: Tx, rec: Recorder, leadId: string, data: { nextAt?: Date | null; attempts?: number; ownerId?: string | null }) {
  await rec.before("lead", leadId, Object.keys(data));
  await tx.lead.update({ where: { id: leadId }, data });
}

// ---------------------------------------------------------------- assignment

/** The person with the fewest new leads this week, among those who get leads automatically. */
export async function pickAutoOwner(tx: Tx): Promise<string | null> {
  const people = await tx.user.findMany({ where: { autoAssign: true, active: true, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!people.length) return null;
  const since = addDays(new Date(), -7);
  const counts = await tx.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: people.map((p) => p.id) }, createdAt: { gte: since } }, _count: { _all: true } });
  const n = (id: string) => counts.find((c) => c.ownerId === id)?._count._all ?? 0;
  return people.map((p) => p.id).sort((a, b) => n(a) - n(b))[0] ?? null;
}

export async function assignLead(tx: Tx, rec: Recorder, leadId: string, ownerId: string | null, by: By) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.ownerId === ownerId) return;
  const owner = ownerId ? await tx.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null;
  await setLead(tx, rec, leadId, { ownerId });
  // the new owner also gets the lead's open tasks
  if (ownerId) {
    const open = await tx.task.findMany({ where: { leadId, done: false, userId: lead.ownerId ?? undefined } });
    for (const t of open) {
      await rec.before("task", t.id, ["userId"]);
      await tx.task.update({ where: { id: t.id }, data: { userId: ownerId } });
    }
  }
  await addActivity(tx, rec, leadId, { kind: "status", text: owner ? `הליד הועבר ל${owner.name}` : "השיוך הוסר", userId: by.id });
}

// ---------------------------------------------------------------- new leads

export type NewLeadInput = {
  name: string;
  phone: string; // E.164
  email?: string | null;
  source: string;
  projectId?: string | null;
  owner?: string | "auto" | null;
  consent?: boolean;
  campaign?: string | null;
  page?: string | null;
  payload?: unknown;
};

/** Creates a lead, or adds the inquiry to the existing lead with the same phone number. */
export async function createOrMergeLead(tx: Tx, rec: Recorder, input: NewLeadInput, by: By | null): Promise<{ leadId: string; duplicate: boolean; ownerName: string | null }> {
  const existing = await tx.lead.findUnique({ where: { phone: input.phone }, include: { owner: { select: { name: true } } } });
  const inquiry = { source: input.source, projectId: input.projectId ?? null, campaign: input.campaign ?? null, page: input.page ?? null, payload: (input.payload ?? undefined) as never };
  if (existing) {
    const iq = await tx.inquiry.create({ data: { leadId: existing.id, ...inquiry } });
    rec.created("inquiry", iq.id);
    await addActivity(tx, rec, existing.id, { kind: "in", text: `פנייה חוזרת מאותו טלפון. מקור: ${input.source}`, auto: "לא נוצר ליד כפול", userId: by?.id ?? null });
    if (existing.status === "lost") await setLeadStatus(tx, rec, existing.id, "new", by?.id ?? null, { auto: "הליד פנה שוב, ולכן חזר ל״חדש״" });
    return { leadId: existing.id, duplicate: true, ownerName: existing.owner?.name ?? null };
  }
  const ownerId = input.owner === "auto" ? await pickAutoOwner(tx) : (input.owner ?? null);
  const owner = ownerId ? await tx.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null;
  const lead = await tx.lead.create({
    data: {
      name: input.name.trim(),
      phone: input.phone,
      email: input.email?.trim() || null,
      source: input.source,
      projectId: input.projectId ?? null,
      ownerId,
      consent: !!input.consent,
      createdById: by?.id ?? null,
      inquiries: { create: inquiry },
    },
  });
  rec.created("lead", lead.id);
  await addActivity(tx, rec, lead.id, {
    kind: "in",
    text: by ? `ליד חדש נוסף ידנית. מקור: ${input.source}` : `ליד חדש נכנס. מקור: ${input.source}`,
    auto: owner ? `שויך ל${owner.name}` : null,
    userId: by?.id ?? null,
  });
  return { leadId: lead.id, duplicate: false, ownerName: owner?.name ?? null };
}

// ---------------------------------------------------------------- call outcomes

/** A call with no answer: counts the attempt, schedules a retry in two hours. */
export async function logNoAnswer(tx: Tx, rec: Recorder, leadId: string, by: By, opts: { park?: boolean } = {}): Promise<string> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const attempts = lead.attempts + 1;
  const retry = new Date(Date.now() + 2 * HOUR);
  await setLead(tx, rec, leadId, { attempts, nextAt: retry });
  await addActivity(tx, rec, leadId, { kind: "miss", text: `שיחה יוצאת: אין מענה (ניסיון ${attempts})`, auto: "תזכורת לנסות שוב בעוד שעתיים", userId: by.id });
  await addTask(tx, rec, { leadId, userId: lead.ownerId ?? by.id, title: `לנסות שוב להתקשר ל${lead.name}`, dueAt: retry, auto: "retry", createdById: by.id });
  if (attempts >= 3 && lead.status !== "noans") {
    await setLeadStatus(tx, rec, leadId, "noans", by.id, { auto: "אחרי 3 ניסיונות בלי מענה" });
    return `תועד: אין מענה (ניסיון ${attempts}). כדאי לשלוח ל${lead.name.split(/\s+/)[0]} וואטסאפ ״ניסינו להשיג אותך״`;
  }
  if (opts.park) await setLeadStatus(tx, rec, leadId, "noans", by.id);
  else if (lead.status === "new") await setLeadStatus(tx, rec, leadId, "process", by.id, { auto: "עודכן אוטומטית מהשיחה" });
  return `תועד: אין מענה (ניסיון ${attempts} מתוך 3). נזכיר לך לנסות שוב בעוד שעתיים`;
}

export async function logCallback(tx: Tx, rec: Recorder, leadId: string, by: By, when: Date, label: string): Promise<string> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  await addActivity(tx, rec, leadId, { kind: "call", text: `שיחה יוצאת: היה מענה. לחזור ${label}`, userId: by.id });
  await setLead(tx, rec, leadId, { nextAt: when });
  await addTask(tx, rec, { leadId, userId: lead.ownerId ?? by.id, title: `לחזור ל${lead.name}`, dueAt: when, auto: "callback", createdById: by.id });
  if (lead.status === "new" || lead.status === "noans") await setLeadStatus(tx, rec, leadId, "process", by.id, { auto: "עודכן אוטומטית מהשיחה" });
  return `נשמר: לחזור ל${lead.name.split(/\s+/)[0]} ${label}. תופיע לך תזכורת`;
}

export async function logLost(tx: Tx, rec: Recorder, leadId: string, by: By, reason: string, fromCall: boolean): Promise<string> {
  if (fromCall) await addActivity(tx, rec, leadId, { kind: "call", text: "שיחה יוצאת: היה מענה", userId: by.id });
  await setLeadStatus(tx, rec, leadId, "lost", by.id, { reason });
  await closeOpenTasks(tx, rec, leadId);
  return `סומן ״לא רלוונטי״: ${reason}`;
}

async function closeOpenTasks(tx: Tx, rec: Recorder, leadId: string) {
  const open = await tx.task.findMany({ where: { leadId, done: false, auto: { not: null } } });
  for (const t of open) {
    await rec.before("task", t.id, ["done", "doneAt", "voided"]);
    await tx.task.update({ where: { id: t.id }, data: { done: true, doneAt: new Date(), voided: true } });
  }
}

// ---------------------------------------------------------------- meetings

export function meetingWhen(d: Date): string {
  return `${WD[d.getDay()]} ${fD(d)} בשעה ${fT(d)}`;
}

export async function bookMeeting(tx: Tx, rec: Recorder, leadId: string, by: By, m: { start: Date; place: string; direct: boolean; hostId?: string | null }) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const meeting = await tx.meeting.create({ data: { leadId, projectId: lead.projectId, startAt: m.start, place: m.place, status: "set", setById: by.id, hostId: m.hostId ?? by.id } });
  rec.created("meeting", meeting.id);
  if (!m.direct) await addActivity(tx, rec, leadId, { kind: "call", text: "שיחה יוצאת: היה מענה", userId: by.id });
  await addActivity(tx, rec, leadId, { kind: "meeting", text: `נקבעה פגישה ל${meetingWhen(m.start)}, ${m.place}`, userId: by.id });
  await setLead(tx, rec, leadId, { nextAt: m.start });
  await setLeadStatus(tx, rec, leadId, "meet", by.id, { auto: "עודכן אוטומטית מהפגישה" });
  await closeOpenTasks(tx, rec, leadId);
  return meeting;
}

export async function moveMeeting(tx: Tx, rec: Recorder, meetingId: string, by: By, start: Date) {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
  await rec.before("meeting", meetingId, ["startAt", "status", "confirmed"]);
  await tx.meeting.update({ where: { id: meetingId }, data: { startAt: start, status: "set", confirmed: false } });
  if (!m.leadId) return; // a meeting without a lead has no card to update
  await addActivity(tx, rec, m.leadId, { kind: "meeting", text: `הפגישה הועברה ל${meetingWhen(start)}`, userId: by.id });
  await setLead(tx, rec, m.leadId, { nextAt: start });
  await setLeadStatus(tx, rec, m.leadId, "meet", by.id, { auto: "עודכן אוטומטית מהפגישה" });
}

export async function confirmMeeting(tx: Tx, rec: Recorder, meetingId: string, by: By, confirmed: boolean) {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
  if (m.confirmed === confirmed) return;
  await rec.before("meeting", meetingId, ["confirmed"]);
  await tx.meeting.update({ where: { id: meetingId }, data: { confirmed } });
  if (m.leadId) await addActivity(tx, rec, m.leadId, { kind: "meeting", text: confirmed ? `הלקוח אישר הגעה לפגישה של ${meetingWhen(m.startAt)}` : "אישור ההגעה בוטל", userId: by.id });
}

/** Changes a meeting's status and keeps its lead, if it has one, in step: held → "התקיימה פגישה", cancelled → "לתאם מחדש" with a task. */
export async function setMeetingStatus(tx: Tx, rec: Recorder, meetingId: string, st: MeetingStatus, by: By): Promise<string> {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { lead: true } });
  if (m.status === st) return "";
  await rec.before("meeting", meetingId, ["status", "confirmed"]);
  await tx.meeting.update({ where: { id: meetingId }, data: { status: st, confirmed: st === "set" ? m.confirmed : false } });
  const first = meetingClient(m).split(/\s+/)[0];
  if (!m.leadId || !m.lead) return (m.clientName ? `הפגישה עם ${first}` : "הפגישה") + ` סומנה ״${MS[st].l}״`;
  const lead = m.lead;
  const word = st === "held" ? "התקיימה" : st === "cancel" ? "בוטלה" : "תואמה מחדש";
  await addActivity(tx, rec, lead.id, { kind: "meeting", text: `הפגישה של ${meetingWhen(m.startAt)} ${word}`, userId: by.id });
  if (st !== "cancel") {
    // a cancel that is reversed by hand must not leave its "reschedule" task behind
    const auto = await tx.task.findMany({ where: { leadId: lead.id, auto: "resched", done: false } });
    for (const t of auto) {
      await rec.before("task", t.id, ["done", "doneAt", "voided"]);
      await tx.task.update({ where: { id: t.id }, data: { done: true, doneAt: new Date(), voided: true } });
    }
  }
  if (st === "held") {
    await setLeadStatus(tx, rec, lead.id, "held", by.id, { auto: "עודכן אוטומטית מהפגישה" });
    let d = addDays(sod(new Date()), 3);
    while (d.getDay() === 5 || d.getDay() === 6) d = addDays(d, 1);
    await addTask(tx, rec, { leadId: lead.id, userId: lead.ownerId ?? m.setById ?? by.id, title: `שיחת המשך עם ${lead.name} אחרי הפגישה`, dueAt: at(d, 10), auto: "follow", createdById: by.id });
    return `הפגישה עם ${first} סומנה ״התקיימה״. נוספה שיחת המשך בעוד 3 ימים`;
  }
  if (st === "set") {
    await setLeadStatus(tx, rec, lead.id, "meet", by.id, { auto: "עודכן אוטומטית מהפגישה" });
    return `הפגישה עם ${first} חזרה ל״תואמה״`;
  }
  const other = await tx.meeting.count({ where: { leadId: lead.id, id: { not: m.id }, status: "set", startAt: { gte: new Date() } } });
  if (!other) {
    await setLeadStatus(tx, rec, lead.id, "resched", by.id, { auto: "עודכן אוטומטית מהפגישה" });
    await addTask(tx, rec, { leadId: lead.id, userId: lead.ownerId ?? m.setById ?? by.id, title: `לתאם מחדש פגישה עם ${lead.name}`, dueAt: at(nextWorkday(), 10), auto: "resched", createdById: by.id });
    return `הפגישה עם ${first} בוטלה. הליד עבר ל״לתאם מחדש״ ונוצרה משימה`;
  }
  return `הפגישה עם ${first} בוטלה`;
}

// ---------------------------------------------------------------- tasks

export async function setTaskDone(tx: Tx, rec: Recorder, taskId: string, done: boolean, by: By) {
  const t = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
  if (t.done === done) return t;
  await rec.before("task", taskId, ["done", "doneAt", "voided"]);
  const row = await tx.task.update({ where: { id: taskId }, data: { done, doneAt: done ? new Date() : null, voided: false } });
  if (done && t.leadId) await addActivity(tx, rec, t.leadId, { kind: "task", text: `בוצעה משימה: ${t.title}`, userId: by.id });
  return row;
}

// ---------------------------------------------------------------- the call queue

export type QueueItem = { leadId: string; why: string; late: boolean; meetingId?: string };

/** Who to call now, in order: new leads, callbacks that are due, then tomorrow's meetings to confirm. */
export async function buildQueue(userId: string, now = new Date()): Promise<QueueItem[]> {
  const endOfToday = addDays(sod(now), 1);
  const next = nextWorkday(now);
  const [fresh, due, meetings] = await Promise.all([
    prisma.lead.findMany({ where: { ownerId: userId, status: "new" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true } }),
    prisma.lead.findMany({
      where: { ownerId: userId, status: { in: ["process", "noans", "follow", "resched", "held"] }, nextAt: { lt: endOfToday } },
      orderBy: { nextAt: "asc" },
      select: { id: true, status: true, nextAt: true },
    }),
    prisma.meeting.findMany({
      where: { setById: userId, status: "set", confirmed: false, leadId: { not: null }, startAt: { gte: sod(next), lt: addDays(sod(next), 1) } },
      orderBy: { startAt: "asc" },
      select: { id: true, leadId: true, startAt: true },
    }),
  ]);
  const q: QueueItem[] = [];
  const seen = new Set<string>();
  for (const l of fresh) {
    seen.add(l.id);
    q.push({ leadId: l.id, why: `ליד חדש. נכנס ${relTime(l.createdAt, now)}`, late: now.getTime() - l.createdAt.getTime() > 2 * HOUR });
  }
  for (const l of due) {
    if (seen.has(l.id) || !l.nextAt) continue;
    seen.add(l.id);
    const late = sod(l.nextAt) < sod(now);
    const why =
      l.status === "resched" ? "הפגישה בוטלה. צריך לקבוע מועד חדש" : l.status === "held" || l.status === "follow" ? "אחרי פגישה. לבדוק איך מתקדמים" : l.status === "noans" ? "לא היה מענה בפעם הקודמת. לנסות שוב" : "הגיע הזמן לחזור, כמו שסוכם";
    q.push({ leadId: l.id, why: why + (late ? ` (מאז ${fD(l.nextAt)})` : ""), late });
  }
  const nextWord = sameDay(next, addDays(sod(now), 1)) ? "מחר" : "ב" + WD[next.getDay()];
  for (const m of meetings) {
    if (!m.leadId || seen.has(m.leadId)) continue;
    seen.add(m.leadId);
    q.push({ leadId: m.leadId, why: `לאשר הגעה לפגישה ${nextWord} ב-${fT(m.startAt)}`, late: false, meetingId: m.id });
  }
  return q;
}
