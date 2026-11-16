"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { isLeadStatus, isMeetingState, isMeetingStatus, isTaskState, meetingClient, OFFICE } from "@/lib/crm/constants";
import { getLists } from "@/lib/lists";
import { LATER, laterDate, laterLabel, type LaterKey } from "@/lib/crm/dates";
import * as crm from "@/lib/crm/service";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { leadScope } from "@/lib/crm/views";
import { ActionError, can, requestIp, requireActionUser, type CurrentUser } from "@/lib/session";
import { defaultMeetingHost } from "@/lib/settings";
import { withUndo } from "@/lib/undo";

const by = (u: CurrentUser) => ({ id: u.id, name: u.name });

function refresh() {
  revalidatePath("/", "layout");
}

async function leadFor(u: CurrentUser, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: String(leadId) } });
  if (!lead) throw new ActionError("הלקוח לא נמצא. אולי הוא נמחק.");
  if (!can(u, "leads.view_all") && lead.ownerId !== u.id) throw new ActionError("אין לך גישה ללקוח הזה");
  return lead;
}

async function meetingFor(u: CurrentUser, meetingId: string) {
  const m = await prisma.meeting.findUnique({ where: { id: String(meetingId) }, include: { lead: true } });
  if (!m) throw new ActionError("הפגישה לא נמצאה");
  const mine = m.setById === u.id || m.hostId === u.id || m.lead?.ownerId === u.id;
  if (!mine && !can(u, "meetings.manage_all")) throw new ActionError("אפשר לעדכן רק פגישות שלך");
  if (!can(u, "leads.view_all") && !mine) throw new ActionError("אין לך גישה לפגישה הזו");
  return m;
}

function parseSlot(day: string, time: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time));
  if (!d || !t) throw new ActionError("צריך לבחור יום ושעה");
  const start = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (Number.isNaN(start.getTime())) throw new ActionError("צריך לבחור יום ושעה");
  if (start.getDay() === 6) throw new ActionError("שבת לא מתאימה לפגישות. אפשר לבחור יום אחר.");
  if (start.getTime() < Date.now() - 5 * 60_000) throw new ActionError("המועד שנבחר כבר עבר. אפשר לבחור מועד אחר.");
  return start;
}

// ---------------------------------------------------------------- new lead

const newLeadSchema = z.object({
  name: z.string().trim().min(2, "צריך לכתוב את השם של הלקוח").max(120),
  phone: z.string().trim().min(1, "צריך לכתוב מספר טלפון"),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  projectId: z.string().min(1, "צריך לבחור פרויקט"),
  source: z.string().trim().min(1).max(60),
  owner: z.string().min(1),
  consent: z.boolean().optional(),
});

export async function createLeadAction(input: z.input<typeof newLeadSchema>): Promise<ActionResult<{ leadId: string; duplicate: boolean }>> {
  return run(async () => {
    const u = await requireActionUser("leads.create");
    const data = newLeadSchema.parse(input);
    const phone = normalizePhone(data.phone);
    if (!phone) throw new ActionError("המספר לא נראה תקין. צריך 10 ספרות, למשל 050-1234567", "phone");
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new ActionError("האימייל לא נראה תקין", "email");
    const project = await prisma.project.findUnique({ where: { id: data.projectId } });
    if (!project) throw new ActionError("צריך לבחור פרויקט", "projectId");
    let owner: string | "auto" | null = u.id;
    if (data.owner === "auto") owner = "auto";
    else if (data.owner !== u.id) {
      if (!can(u, "leads.assign")) throw new ActionError("אין לך הרשאה לשייך לקוחות לאחרים", "owner");
      const target = await prisma.user.findFirst({ where: { id: data.owner, active: true, deletedAt: null } });
      if (!target) throw new ActionError("מנהל הלקוח שנבחר לא פעיל", "owner");
      owner = target.id;
    }
    const source = (await getLists()).sources.includes(data.source) ? data.source : "אחר";
    const { result, undoId } = await withUndo(u.id, "הוספת לקוח", (tx, rec) =>
      crm.createOrMergeLead(tx, rec, { name: data.name, phone, email: data.email || null, source, projectId: project.id, owner, consent: data.consent }, by(u)),
    );
    refresh();
    // someone who sees only their own leads isn't shown another agent's lead
    const hidden = result.duplicate && !can(u, "leads.view_all") && result.ownerId !== u.id;
    const message = hidden
      ? "הטלפון הזה כבר שייך ללקוח שמנוהל בידי מישהו אחר. הפנייה נוספה לכרטיס הקיים"
      : result.duplicate
        ? `הטלפון כבר קיים, ולכן הפנייה נוספה לכרטיס הקיים`
        : `הלקוח ${data.name} נשמר` + (result.ownerName ? (result.ownerName === u.name ? " אצלך" : ` ושויך ל${result.ownerName}`) : "");
    return { message, undoId: result.duplicate ? undefined : undoId, data: { leadId: hidden ? "" : result.leadId, duplicate: result.duplicate } };
  });
}

// ---------------------------------------------------------------- call outcomes

export async function noAnswerAction(leadId: string, park = false): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const { result, undoId } = await withUndo(u.id, "תיעוד שיחה בלי מענה", (tx, rec) => crm.logNoAnswer(tx, rec, lead.id, by(u), { park }));
    refresh();
    return { message: result, undoId };
  });
}

export async function callbackAction(leadId: string, later: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    if (!(LATER as readonly string[]).includes(later)) throw new ActionError("צריך לבחור מתי לחזור");
    const k = later as LaterKey;
    const { result, undoId } = await withUndo(u.id, "תיעוד שיחה: לחזור אחר כך", (tx, rec) => crm.logCallback(tx, rec, lead.id, by(u), laterDate(k), laterLabel(k)));
    refresh();
    return { message: result, undoId };
  });
}

export async function lostAction(leadId: string, reason: string, fromCall = true): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const r = (await getLists()).reasons.some((x) => x.label === reason) ? reason : "אחר";
    const { result, undoId } = await withUndo(u.id, "סימון ״לא רלוונטי״", (tx, rec) => crm.logLost(tx, rec, lead.id, by(u), r, fromCall));
    refresh();
    return { message: result, undoId };
  });
}

/** Every meeting is at the office. Returns what the screen needs for the WhatsApp message with the details. */
export async function bookMeetingAction(leadId: string, day: string, time: string, direct: boolean, hostId?: string | null): Promise<ActionResult<{ meetingId: string; startAt: string; hostName: string | null }>> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const start = parseSlot(day, time);
    // the meeting is with the person picked, else the one set for meetings, else whoever booked it
    const picked = hostId ? await prisma.user.findFirst({ where: { id: String(hostId), active: true, deletedAt: null }, select: { id: true } }) : null;
    if (hostId && !picked) throw new ActionError("מי שנבחר לפגישה לא פעיל במערכת", "host");
    const host = picked?.id ?? (await defaultMeetingHost()) ?? u.id;
    const { result: m, undoId } = await withUndo(u.id, "קביעת פגישה", (tx, rec) => crm.bookMeeting(tx, rec, lead.id, by(u), { start, place: OFFICE.place, direct, hostId: host }));
    refresh();
    const hostUser = m.hostId ? await prisma.user.findUnique({ where: { id: m.hostId }, select: { name: true } }) : null;
    const { dayLabel, fT } = await import("@/lib/crm/dates");
    const moved = m.hostId && m.hostId !== lead.ownerId && hostUser ? `. הלקוח עבר ל${hostUser.name}` : "";
    return { message: `הפגישה עם ${lead.name.split(/\s+/)[0]} נקבעה ל${dayLabel(start)} ב-${fT(start)}${moved}`, undoId, data: { meetingId: m.id, startAt: start.toISOString(), hostName: hostUser?.name ?? null } };
  });
}

export async function moveMeetingAction(meetingId: string, day: string, time: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const m = await meetingFor(u, meetingId);
    const start = parseSlot(day, time);
    const { undoId } = await withUndo(u.id, "העברת פגישה", (tx, rec) => crm.moveMeeting(tx, rec, m.id, by(u), start));
    refresh();
    const { dayLabel, fT } = await import("@/lib/crm/dates");
    return { message: `הפגישה הועברה ל${dayLabel(start)} ב-${fT(start)}`, undoId };
  });
}

export async function confirmMeetingAction(meetingId: string, confirmed: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const m = await meetingFor(u, meetingId);
    const { undoId } = await withUndo(u.id, confirmed ? "אישור הגעה" : "ביטול אישור הגעה", (tx, rec) => crm.confirmMeeting(tx, rec, m.id, by(u), confirmed));
    refresh();
    return { message: confirmed ? (m.lead || m.clientName ? `סומן: ההגעה של ${meetingClient(m).split(/\s+/)[0]} אושרה` : "סומן: ההגעה אושרה") : "אישור ההגעה בוטל", undoId };
  });
}

export async function meetingStatusAction(meetingId: string, status: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    if (!isMeetingStatus(status)) throw new ActionError("סטטוס לא מוכר");
    const m = await meetingFor(u, meetingId);
    const { result, undoId } = await withUndo(u.id, "עדכון סטטוס פגישה", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, status, by(u)));
    refresh();
    return { message: result || "לא היה מה לשנות", undoId };
  });
}

/**
 * One of the six states people pick: נקבעה, אושרה הגעה, התקיימה, אי-הגעה, בוטלה, לתאם מחדש.
 * "אושרה הגעה" is a meeting that is still set, with the arrival confirmed.
 */
export async function meetingStateAction(meetingId: string, state: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    if (!isMeetingState(state)) throw new ActionError("סטטוס לא מוכר");
    const m = await meetingFor(u, meetingId);
    const { result, undoId } = await withUndo(u.id, "עדכון סטטוס פגישה", async (tx, rec) => {
      if (state !== "set" && state !== "confirmed") return crm.setMeetingStatus(tx, rec, m.id, state, by(u));
      const moved = await crm.setMeetingStatus(tx, rec, m.id, "set", by(u));
      await crm.confirmMeeting(tx, rec, m.id, by(u), state === "confirmed");
      return moved || `הפגישה סומנה ״${(await getLists()).meeting[state]}״`;
    });
    refresh();
    return { message: result || "לא היה מה לשנות", undoId };
  });
}

const meetingEdit = z.object({
  note: z.string().max(2000, "התיאור ארוך מדי. אפשר עד 2000 תווים").optional(),
  projectId: z.string().nullable().optional(),
  hostId: z.string().nullable().optional(),
});

/** The meeting card's own details: its description, project, and who meets the client (the client moves to them). */
export async function updateMeetingAction(meetingId: string, input: z.input<typeof meetingEdit>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const m = await meetingFor(u, meetingId);
    const d = meetingEdit.parse(input);
    const data: { note?: string | null; projectId?: string | null; hostId?: string } = {};
    if (d.note !== undefined && d.note.trim() !== (m.note ?? "")) data.note = d.note.trim() || null;
    if (d.projectId !== undefined && (d.projectId || null) !== m.projectId) {
      if (d.projectId && !(await prisma.project.findUnique({ where: { id: d.projectId }, select: { id: true } }))) throw new ActionError("הפרויקט לא נמצא", "projectId");
      data.projectId = d.projectId || null;
    }
    if (d.hostId !== undefined && d.hostId && d.hostId !== m.hostId) {
      const host = await prisma.user.findFirst({ where: { id: d.hostId, active: true, deletedAt: null }, select: { id: true } });
      if (!host) throw new ActionError("מי שנבחר לפגישה לא פעיל במערכת", "hostId");
      data.hostId = host.id;
    }
    if (!Object.keys(data).length) return { message: "הפרטים נשמרו" };
    const { undoId } = await withUndo(u.id, "עדכון פרטי פגישה", async (tx, rec) => {
      await rec.before("meeting", m.id, Object.keys(data));
      await tx.meeting.update({ where: { id: m.id }, data });
      // the person meeting the client manages the client
      if (data.hostId && m.leadId) await crm.assignLead(tx, rec, m.leadId, data.hostId, by(u));
    });
    refresh();
    return { message: data.hostId ? (m.leadId ? "נשמר. הפגישה והלקוח עברו למי שנבחר" : "נשמר. הפגישה עברה למי שנבחר") : "הפרטים נשמרו", undoId };
  });
}

// ---------------------------------------------------------------- lead card

export async function setLeadStatusAction(leadId: string, status: string, reason?: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    if (!isLeadStatus(status)) throw new ActionError("סטטוס לא מוכר");
    const lead = await leadFor(u, leadId);
    if (status === "noans") {
      const { result, undoId } = await withUndo(u.id, "תיעוד שיחה בלי מענה", (tx, rec) => crm.logNoAnswer(tx, rec, lead.id, by(u), { park: true }));
      refresh();
      return { message: result, undoId };
    }
    if (status === "lost") {
      const r = (await getLists()).reasons.some((x) => x.label === reason) ? (reason as string) : "אחר";
      const { result, undoId } = await withUndo(u.id, "סימון ״לא רלוונטי״", (tx, rec) => crm.logLost(tx, rec, lead.id, by(u), r, false));
      refresh();
      return { message: result, undoId };
    }
    const { undoId } = await withUndo(u.id, "שינוי סטטוס", (tx, rec) => crm.setLeadStatus(tx, rec, lead.id, status, u.id));
    refresh();
    const { ST } = await import("@/lib/crm/constants");
    return { message: status === "won" ? `מזל טוב! נרשמה עסקה עם ${lead.name}` : `הסטטוס עודכן ל״${ST[status].l}״`, undoId };
  });
}

export async function assignLeadAction(leadId: string, ownerId: string | null): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.assign");
    const lead = await leadFor(u, leadId);
    let target: string | null = null;
    if (ownerId) {
      const t = await prisma.user.findFirst({ where: { id: ownerId, active: true, deletedAt: null } });
      if (!t) throw new ActionError("המשתמש שנבחר לא פעיל");
      target = t.id;
    }
    const { undoId } = await withUndo(u.id, "שיוך לקוח", (tx, rec) => crm.assignLead(tx, rec, lead.id, target, by(u)));
    refresh();
    const name = target ? (await prisma.user.findUnique({ where: { id: target }, select: { name: true } }))?.name : null;
    return { message: name ? `הלקוח שויך ל${name}` : "השיוך הוסר", undoId };
  });
}

export async function bulkAssignAction(leadIds: string[], ownerId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.assign");
    if (!can(u, "leads.bulk")) throw new ActionError("אין לך הרשאה לפעולות על כמה לקוחות");
    const asked = [...new Set((leadIds ?? []).map(String))].slice(0, 500);
    const t = await prisma.user.findFirst({ where: { id: String(ownerId), active: true, deletedAt: null } });
    if (!t) throw new ActionError("המשתמש שנבחר לא פעיל");
    // only leads this person may see
    const ids = (await prisma.lead.findMany({ where: { AND: [{ id: { in: asked } }, leadScope(u)] }, select: { id: true } })).map((l) => l.id);
    if (!ids.length) throw new ActionError("לא נבחרו לקוחות");
    const { undoId } = await withUndo(
      u.id,
      "שיוך כמה לקוחות",
      async (tx, rec) => {
        for (const id of ids) await crm.assignLead(tx, rec, id, t.id, by(u));
      },
      { timeout: 120_000 },
    );
    await audit({ actorId: u.id, actorName: u.name, action: "lead.bulk_assign", targetName: t.name, meta: { count: ids.length }, ip: await requestIp() });
    refresh();
    return { message: ids.length === 1 ? `הלקוח שויך ל${t.name}` : `${ids.length} לקוחות שויכו ל${t.name}`, undoId };
  });
}

const updateSchema = z.object({
  name: z.string().trim().min(2, "השם קצר מדי").max(120).optional(),
  email: z.string().trim().max(200).optional(),
  projectId: z.string().optional(),
  source: z.string().trim().max(60).optional(),
  nextAt: z.string().optional(),
});

export async function updateLeadAction(leadId: string, patch: z.input<typeof updateSchema>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const p = updateSchema.parse(patch);
    const data: Record<string, unknown> = {};
    if (p.name !== undefined) data.name = p.name;
    if (p.email !== undefined) {
      if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new ActionError("האימייל לא נראה תקין", "email");
      data.email = p.email || null;
    }
    if (p.projectId !== undefined) {
      if (p.projectId && !(await prisma.project.findUnique({ where: { id: p.projectId } }))) throw new ActionError("פרויקט לא מוכר");
      data.projectId = p.projectId || null;
    }
    if (p.source !== undefined) data.source = p.source || lead.source;
    if (p.nextAt !== undefined) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.nextAt);
      data.nextAt = m ? new Date(+m[1], +m[2] - 1, +m[3], 10, 0) : null;
    }
    const { undoId } = await withUndo(u.id, "עדכון פרטי לקוח", async (tx, rec) => {
      await rec.before("lead", lead.id, Object.keys(data));
      await tx.lead.update({ where: { id: lead.id }, data });
    });
    refresh();
    return { message: "הפרטים נשמרו", undoId };
  });
}

export async function addNoteAction(leadId: string, text: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const t = String(text ?? "").trim();
    if (!t) throw new ActionError("צריך לכתוב משהו בהערה");
    if (t.length > 4000) throw new ActionError("ההערה ארוכה מדי");
    const { undoId } = await withUndo(u.id, "הוספת הערה", (tx, rec) => crm.addActivity(tx, rec, lead.id, { kind: "note", text: t, userId: u.id }));
    refresh();
    return { message: "ההערה נשמרה", undoId };
  });
}

/** WhatsApp goes out from the person's own WhatsApp (wa.me link); this records it on the lead. */
export async function logWhatsAppAction(leadId: string, text: string, file?: string | null): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.edit");
    const lead = await leadFor(u, leadId);
    const t = String(text ?? "").trim().slice(0, 4000);
    if (!t && !file) throw new ActionError("צריך לכתוב הודעה");
    const { undoId } = await withUndo(u.id, "תיעוד הודעת וואטסאפ", (tx, rec) =>
      crm.addActivity(tx, rec, lead.id, { kind: "wa", direction: "out", text: t, file: file ? String(file).slice(0, 200) : null, auto: "נשלח מהוואטסאפ של " + u.firstName, userId: u.id }),
    );
    refresh();
    return { message: `נפתח וואטסאפ עם ההודעה ל${lead.name.split(/\s+/)[0]}. ההודעה נרשמה בכרטיס`, undoId };
  });
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.delete");
    const lead = await leadFor(u, leadId);
    // its meetings stay in the meetings list, under the client's name
    await prisma.$transaction([
      prisma.meeting.updateMany({ where: { leadId: lead.id, clientName: null }, data: { clientName: lead.name } }),
      prisma.lead.delete({ where: { id: lead.id } }),
    ]);
    await audit({ actorId: u.id, actorName: u.name, action: "lead.delete", targetType: "lead", targetId: lead.id, targetName: lead.name, ip: await requestIp() });
    refresh();
    return { message: `הלקוח ${lead.name} נמחק` };
  });
}

// ---------------------------------------------------------------- tasks

const taskSchema = z.object({
  title: z.string().trim().min(2, "צריך לכתוב מה לעשות").max(300),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "צריך לבחור יום"),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  userId: z.string().optional(),
  leadId: z.string().optional(),
});

export async function addTaskAction(input: z.input<typeof taskSchema>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const p = taskSchema.parse(input);
    let assignee = u.id;
    if (p.userId && p.userId !== u.id) {
      if (!can(u, "tasks.assign")) throw new ActionError("אין לך הרשאה לתת משימות לאחרים");
      const t = await prisma.user.findFirst({ where: { id: p.userId, active: true, deletedAt: null } });
      if (!t) throw new ActionError("המשתמש שנבחר לא פעיל");
      assignee = t.id;
    }
    if (p.leadId) await leadFor(u, p.leadId);
    const [y, mo, d] = p.day.split("-").map(Number);
    const [hh, mm] = (p.time ?? "10:00").split(":").map(Number);
    const dueAt = new Date(y, mo - 1, d, hh, mm);
    const { undoId } = await withUndo(u.id, "הוספת משימה", (tx, rec) => crm.addTask(tx, rec, { leadId: p.leadId || null, userId: assignee, title: p.title, dueAt, createdById: u.id }));
    refresh();
    const name = assignee === u.id ? null : (await prisma.user.findUnique({ where: { id: assignee }, select: { name: true } }))?.name;
    return { message: name ? `המשימה נוספה ל${name}` : "המשימה נוספה", undoId };
  });
}

export async function taskDoneAction(taskId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const t = await prisma.task.findUnique({ where: { id: String(taskId) } });
    if (!t) throw new ActionError("המשימה לא נמצאה");
    if (t.userId !== u.id && !can(u, "tasks.assign")) throw new ActionError("אפשר לסמן רק משימות שלך");
    if (t.userId !== u.id && t.leadId) await leadFor(u, t.leadId);
    const { undoId } = await withUndo(u.id, done ? "סימון משימה כבוצעה" : "החזרת משימה", (tx, rec) => crm.setTaskDone(tx, rec, t.id, done, by(u)));
    refresh();
    return { message: (done ? "בוצע: " : "חזר לפתוחות: ") + t.title, undoId };
  });
}

/** פתוחה, בטיפול, הושלמה or בוטלה. */
export async function taskStateAction(taskId: string, state: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    if (!isTaskState(state)) throw new ActionError("סטטוס לא מוכר");
    const t = await prisma.task.findUnique({ where: { id: String(taskId) } });
    if (!t) throw new ActionError("המשימה לא נמצאה");
    if (t.userId !== u.id && !can(u, "tasks.assign")) throw new ActionError("אפשר לעדכן רק משימות שלך");
    if (t.userId !== u.id && t.leadId) await leadFor(u, t.leadId);
    const { undoId } = await withUndo(u.id, "עדכון סטטוס משימה", (tx, rec) => crm.setTaskState(tx, rec, t.id, state, by(u)));
    refresh();
    return { message: `${t.title}: ${(await getLists()).task[state]}`, undoId };
  });
}

/**
 * My tasks that fell due in the last half hour, for the reminder that pops up on screen. Older ones are in the overdue list,
 * so someone signing in after a day off isn't met by a pile of pop-ups. Automatic "try again" reminders stay in the call queue.
 */
export async function dueTasksAction(): Promise<ActionResult<{ id: string; title: string; dueAt: string; leadId: string | null; leadName: string | null }[]>> {
  return run(async () => {
    const u = await requireActionUser();
    const now = new Date();
    const rows = await prisma.task.findMany({
      where: { userId: u.id, done: false, dueAt: { lte: now, gte: new Date(now.getTime() - 30 * 60_000) }, OR: [{ auto: null }, { auto: { not: "retry" } }] },
      // the one that just fell due first
      orderBy: { dueAt: "desc" },
      take: 10,
      include: { lead: { select: { name: true } } },
    });
    return { data: rows.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt.toISOString(), leadId: t.leadId, leadName: t.lead?.name ?? null })) };
  });
}

export async function autoAssignAction(leadIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("leads.assign");
    const asked = [...new Set((leadIds ?? []).map(String))].slice(0, 500);
    const ids = (await prisma.lead.findMany({ where: { AND: [{ id: { in: asked }, ownerId: null }, leadScope(u)] }, select: { id: true } })).map((l) => l.id);
    const { result, undoId } = await withUndo(
      u.id,
      "שיוך אוטומטי",
      async (tx, rec) => {
        // spread evenly: each lead goes to whoever has the fewest, counting the ones handed out here
        const pick = await crm.autoOwnerPicker(tx);
        let n = 0;
        for (const id of ids) {
          const owner = pick();
          if (!owner) break;
          await crm.assignLead(tx, rec, id, owner, by(u));
          n++;
        }
        return n;
      },
      { timeout: 120_000 },
    );
    refresh();
    if (!result) throw new ActionError("אין סוכנים בחלוקה האוטומטית. אפשר להוסיף אותם במסך המשתמשים.");
    return { message: result === 1 ? "לקוח אחד חולק אוטומטית" : `${result} לקוחות חולקו אוטומטית`, undoId };
  });
}

/** For the "new meeting" sheet: find a lead by name or phone digits. */
export async function searchLeadsAction(q: string): Promise<ActionResult<{ id: string; name: string; phone: string; projectName: string }[]>> {
  return run(async () => {
    const u = await requireActionUser();
    const text = String(q ?? "").trim().slice(0, 60);
    const digits = text.replace(/\D/g, "");
    const scope = can(u, "leads.view_all") ? {} : { ownerId: u.id };
    const where = text
      ? { AND: [scope, { status: { notIn: ["won", "lost"] } }, { OR: [{ name: { contains: text, mode: "insensitive" as const } }, ...(digits.length >= 3 ? [{ phone: { contains: digits.replace(/^0/, "") } }] : [])] }] }
      : { AND: [scope, { ownerId: u.id }, { status: { notIn: ["won", "lost"] } }] };
    const rows = await prisma.lead.findMany({ where, orderBy: { lastActivityAt: "desc" }, take: 6, include: { project: { select: { name: true } } } });
    const { formatPhone } = await import("@/lib/phone");
    return { data: rows.map((l) => ({ id: l.id, name: l.name, phone: formatPhone(l.phone), projectName: l.project?.name ?? "" })) };
  });
}
