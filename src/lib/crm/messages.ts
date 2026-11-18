// WhatsApp messages a manager can word: each one is a title (the button) and a text with fields in braces,
// such as {לקוח} or {שעה}, filled in when the message is sent. Nothing here touches the database, so the
// settings screen, the sheets and the tests share it.

export type WaTemplate = { id: string; title: string; text: string };

/** The message sent right after booking a meeting, and from the meeting's card. It can be reworded, not removed. */
export const MEETING_TEMPLATE = "meeting";

export const FIELDS = [
  { key: "לקוח", label: "השם הפרטי של הלקוח" },
  { key: "נציג", label: "השם הפרטי של מי ששולח" },
  { key: "פרויקט", label: "הפרויקט" },
  { key: "יום", label: "יום הפגישה, למשל שלישי 18.11" },
  { key: "שעה", label: "שעת הפגישה" },
  { key: "נפגשים עם", label: "עם מי הפגישה" },
  { key: "כתובת", label: "כתובת המשרד" },
  { key: "ווייז", label: "קישור קצר לניווט בווייז" },
] as const;
export type FieldKey = (typeof FIELDS)[number]["key"];

/** Fields that only a meeting has: a message with one of them is offered when the client has a meeting coming. */
const MEETING_FIELDS: FieldKey[] = ["יום", "שעה", "נפגשים עם"];

export const MAX_TEMPLATES = 20;
export const MAX_TITLE = 40;
export const MAX_TEXT = 1500;

export const DEFAULT_TEMPLATES: WaTemplate[] = [
  {
    id: MEETING_TEMPLATE,
    title: "פרטי הפגישה",
    text: [
      "היי {לקוח}, כאן {נציג} מקבוצת מיתר 😊",
      "שמחתי לדבר איתך! אלה פרטי הפגישה שלנו:",
      "",
      "מתי: יום {יום} בשעה {שעה}",
      "איפה: {כתובת}",
      "בנושא: {פרויקט}",
      "נפגשים עם: {נפגשים עם}",
      "",
      "ניווט בווייז: {ווייז}",
      "",
      "מחכים לראות אותך! לכל שאלה אני כאן.",
    ].join("\n"),
  },
  { id: "project", title: "פרטים על הפרויקט", text: "היי {לקוח}, כאן {נציג} מקבוצת מיתר 😊\nשולחים לך את כל הפרטים על {פרויקט}. נשמח לענות על כל שאלה!" },
  { id: "missed", title: "ניסינו להשיג אותך", text: "היי {לקוח}, כאן {נציג} מקבוצת מיתר. ניסיתי להשיג אותך בקשר ל{פרויקט}. מתי נוח לך שנדבר?" },
  { id: "confirm", title: "בקשת אישור הגעה", text: "היי {לקוח}, כאן {נציג} מקבוצת מיתר 😊\nמזכירים שנפגשים ביום {יום} בשעה {שעה} ב{כתובת}.\nנשמח לאישור הגעה. ניווט בווייז: {ווייז}" },
  { id: "office", title: "מיקום המשרד", text: "המשרד שלנו נמצא ב{כתובת}.\nניווט בווייז: {ווייז}" },
];

const FIELD_RE = /\{([^{}\n]{1,20})\}/g;
const KNOWN = new Set<string>(FIELDS.map((f) => f.key));

/** The fields a text uses that this system doesn't know, so the settings screen can point them out. */
export function unknownFields(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD_RE)].map((m) => m[1].trim()).filter((k) => !KNOWN.has(k)))];
}

export const needsMeeting = (t: Pick<WaTemplate, "text">) => [...t.text.matchAll(FIELD_RE)].some((m) => MEETING_FIELDS.includes(m[1].trim() as FieldKey));

export type Values = Partial<Record<FieldKey, string | null>>;

/**
 * The text with its fields filled in. A line like "בנושא: {פרויקט}" is left out when the client has no
 * project; elsewhere a missing project reads "הפרויקט" ("בקשר ל{פרויקט}" becomes "בקשר לפרויקט").
 */
export function fillTemplate(text: string, values: Values): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const missing = [...line.matchAll(FIELD_RE)].filter((m) => KNOWN.has(m[1].trim()) && !values[m[1].trim() as FieldKey]?.trim());
    // "label: {field}" with nothing to put there: the whole line goes
    if (missing.length && missing.some((m) => new RegExp(`:\\s*\\{${escape(m[1])}\\}\\s*$`).test(line))) continue;
    lines.push(
      line.replace(FIELD_RE, (all, raw: string, at: number) => {
        const key = raw.trim();
        if (!KNOWN.has(key)) return all;
        const v = values[key as FieldKey]?.trim();
        if (v) return v;
        // after ב, ל or כ the ה drops: "לפרויקט", "בפרויקט"
        if (key === "פרויקט") return /(^|[^א-ת])[בלכ]$/.test(line.slice(0, at)) ? "פרויקט" : "הפרויקט";
        if (key === "נפגשים עם") return "הצוות שלנו";
        return "";
      }),
    );
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Templates as saved by a manager, cleaned: the meeting message is always there, the rest in their order. */
export function cleanTemplates(raw: unknown): WaTemplate[] {
  if (!Array.isArray(raw)) return DEFAULT_TEMPLATES;
  const seen = new Set<string>();
  const out: WaTemplate[] = [];
  for (const x of raw) {
    const t = x as Partial<WaTemplate>;
    const id = typeof t?.id === "string" ? t.id.trim().slice(0, 40) : "";
    const title = typeof t?.title === "string" ? t.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
    const text = typeof t?.text === "string" ? t.text.replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT) : "";
    if (!id || !title || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, text });
    if (out.length >= MAX_TEMPLATES) break;
  }
  if (!out.some((t) => t.id === MEETING_TEMPLATE)) out.unshift(DEFAULT_TEMPLATES[0]);
  return out;
}
