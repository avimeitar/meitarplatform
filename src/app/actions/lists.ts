"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MEETING_STATE_ORDER, TASK_STATE_ORDER } from "@/lib/crm/constants";
import { prisma } from "@/lib/db";
import { cleanTemplates, MAX_TEMPLATES, MAX_TEXT, MAX_TITLE, MEETING_TEMPLATE, type WaTemplate } from "@/lib/crm/messages";
import { cleanItem, saveList } from "@/lib/lists";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";
import { setDefaultMeetingHost } from "@/lib/settings";

// the lists show up in forms and filters everywhere
function refresh() {
  revalidatePath("/", "layout");
}

async function record(u: { id: string; name: string }, what: string, meta: Record<string, unknown> = {}) {
  await audit({ actorId: u.id, actorName: u.name, action: "settings.lists", meta: { list: what, ...meta }, ip: await requestIp() });
}

/** Sources to pick when adding a lead by hand. */
export async function saveSourcesAction(list: string[]): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("lists.manage");
    const items = [...new Set((Array.isArray(list) ? list : []).map((x) => cleanItem(x)).filter(Boolean))].slice(0, 60);
    if (!items.length) throw new ActionError("צריך לפחות מקור הגעה אחד");
    await saveList("sources", items);
    await record(u, "sources", { count: items.length });
    refresh();
    return { message: "מקורות ההגעה נשמרו" };
  });
}

/** Reasons for "לא רלוונטי"; `junk` marks a lead that was never real (the performance screen leaves it out of "relevant"). */
export async function saveReasonsAction(list: { label: string; junk: boolean }[]): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("lists.manage");
    const seen = new Set<string>();
    const items = (Array.isArray(list) ? list : [])
      .map((x) => ({ label: cleanItem(x?.label), junk: !!x?.junk }))
      .filter((x) => x.label && !seen.has(x.label) && seen.add(x.label))
      .slice(0, 30);
    if (!items.length) throw new ActionError("צריך לפחות סיבה אחת");
    await saveList("reasons", items);
    await record(u, "reasons", { count: items.length });
    refresh();
    return { message: "הסיבות נשמרו" };
  });
}

/** Names of meeting or task statuses. An empty name goes back to the built-in one. */
export async function saveLabelsAction(kind: "meeting" | "task", names: Record<string, string>): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("lists.manage");
    if (kind !== "meeting" && kind !== "task") throw new ActionError("רשימה לא מוכרת");
    const keys: string[] = kind === "meeting" ? MEETING_STATE_ORDER : TASK_STATE_ORDER;
    const value = Object.fromEntries(keys.map((k) => [k, cleanItem(names?.[k], 30)]).filter(([, v]) => v));
    await saveList(kind, value);
    await record(u, kind === "meeting" ? "meeting statuses" : "task statuses");
    refresh();
    return { message: kind === "meeting" ? "שמות הסטטוסים של הפגישות נשמרו" : "שמות הסטטוסים של המשימות נשמרו" };
  });
}

/** Who meets the clients: a booked meeting is with this person by default, and the client moves to them. */
export async function setMeetingHostAction(userId: string | null): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("lists.manage");
    let name = "";
    if (userId) {
      const p = await prisma.user.findFirst({ where: { id: String(userId), active: true, deletedAt: null }, select: { id: true, name: true } });
      if (!p) throw new ActionError("המשתמש שנבחר לא פעיל");
      name = p.name;
    }
    await setDefaultMeetingHost(userId ? String(userId) : null);
    await record(u, "meeting host", { userId: userId ?? null });
    refresh();
    return { message: name ? `מעכשיו פגישות נקבעות עם ${name}` : "מעכשיו פגישות נקבעות עם מי שקובע אותן" };
  });
}

/** The WhatsApp messages the team sends, with fields such as {לקוח} filled in when sending. The meeting message always stays. */
export async function saveMessagesAction(list: WaTemplate[]): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser("lists.manage");
    const items = Array.isArray(list) ? list : [];
    if (items.length > MAX_TEMPLATES) throw new ActionError(`אפשר עד ${MAX_TEMPLATES} הודעות`);
    for (const t of items) {
      const title = typeof t?.title === "string" ? t.title.trim() : "";
      const text = typeof t?.text === "string" ? t.text.trim() : "";
      if (!title) throw new ActionError("לכל הודעה צריך שם, כדי שיופיע על הכפתור");
      if (title.length > MAX_TITLE) throw new ActionError(`השם ״${title.slice(0, 20)}…״ ארוך מדי. עד ${MAX_TITLE} תווים`);
      if (!text) throw new ActionError(`ההודעה ״${title}״ ריקה`);
      if (text.length > MAX_TEXT) throw new ActionError(`ההודעה ״${title}״ ארוכה מדי. עד ${MAX_TEXT} תווים`);
    }
    if (!items.some((t) => t?.id === MEETING_TEMPLATE)) throw new ActionError("הודעת פרטי הפגישה נשארת תמיד. אפשר לשנות את הנוסח שלה");
    const value = cleanTemplates(items);
    await saveList("messages", value);
    await record(u, "whatsapp messages", { count: value.length });
    refresh();
    return { message: "ההודעות נשמרו" };
  });
}
