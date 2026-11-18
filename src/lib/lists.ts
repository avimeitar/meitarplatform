// Lists a manager can change: sources for leads added by hand, the reasons for "לא רלוונטי" (and which of them mean
// the lead was never real), the names of meeting and task statuses, and the WhatsApp messages. Until changed, the built-in ones apply.
import { cache } from "react";
import { MANUAL_SOURCES, MEETING_STATE_ORDER, MEETING_STATES, REASONS, TASK_STATE_ORDER, TASK_STATES, type MeetingState, type TaskState } from "./crm/constants";
import { cleanTemplates, DEFAULT_TEMPLATES, type WaTemplate } from "./crm/messages";
import { prisma } from "./db";

export type Reason = { label: string; junk: boolean };
export type Lists = { sources: string[]; reasons: Reason[]; meeting: Record<MeetingState, string>; task: Record<TaskState, string>; messages: WaTemplate[] };

export const LIST_KEYS = { sources: "lists.sources", reasons: "lists.reasons", meeting: "labels.meeting", task: "labels.task", messages: "templates.whatsapp" } as const;

/** Reasons that mean the lead was never real: it denies asking, or the number is wrong. */
const JUNK_DEFAULT = ["הכחשת פנייה", "מספר לא תקין"];

export const DEFAULT_LISTS: Lists = {
  sources: [...MANUAL_SOURCES],
  reasons: REASONS.map((label) => ({ label, junk: JUNK_DEFAULT.includes(label) })),
  meeting: Object.fromEntries(MEETING_STATE_ORDER.map((s) => [s, MEETING_STATES[s].l])) as Record<MeetingState, string>,
  task: Object.fromEntries(TASK_STATE_ORDER.map((s) => [s, TASK_STATES[s].l])) as Record<TaskState, string>,
  messages: DEFAULT_TEMPLATES,
};

export const cleanItem = (s: unknown, max = 40) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

function labels<T extends string>(raw: unknown, def: Record<T, string>): Record<T, string> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(def).map(([k, d]) => [k, cleanItem(r[k], 30) || d])) as Record<T, string>;
}

/** The lists in effect: once per request. */
export const getLists = cache(async (): Promise<Lists> => {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(LIST_KEYS) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const rawSources = v(LIST_KEYS.sources);
  const rawReasons = v(LIST_KEYS.reasons);
  const sources = Array.isArray(rawSources) ? rawSources.map((x) => cleanItem(x)).filter(Boolean) : [];
  const reasons = Array.isArray(rawReasons)
    ? rawReasons.map((x) => ({ label: cleanItem((x as Partial<Reason>)?.label), junk: !!(x as Partial<Reason>)?.junk })).filter((x) => x.label)
    : [];
  return {
    sources: sources.length ? sources : DEFAULT_LISTS.sources,
    reasons: reasons.length ? reasons : DEFAULT_LISTS.reasons,
    meeting: labels(v(LIST_KEYS.meeting), DEFAULT_LISTS.meeting),
    task: labels(v(LIST_KEYS.task), DEFAULT_LISTS.task),
    messages: v(LIST_KEYS.messages) === undefined ? DEFAULT_TEMPLATES : cleanTemplates(v(LIST_KEYS.messages)),
  };
});

export async function saveList(kind: keyof typeof LIST_KEYS, value: unknown): Promise<void> {
  const key = LIST_KEYS[kind];
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** What the browser needs: the reasons as plain names. */
export type ClientLists = { sources: string[]; reasons: string[]; meeting: Record<MeetingState, string>; task: Record<TaskState, string>; messages: WaTemplate[] };
export const toClient = (l: Lists): ClientLists => ({ sources: l.sources, reasons: l.reasons.map((r) => r.label), meeting: l.meeting, task: l.task, messages: l.messages });
