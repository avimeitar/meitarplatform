// Reading Fireberry exports (CSV, Hebrew headers) for the move to the new system: leads, and meetings.
import type { LeadStatus, MeetingStatus } from "./crm/constants";
import { normalizePhone } from "./phone";

export type FbRow = { name: string; phone: string | null; rawPhone: string; email: string; created: Date | null; updated: Date | null; owner: string; status: string; source: string; next: Date | null; ad: string };

/** Fireberry writes "-" in an empty field. */
const clean = (v: string) => (v.trim() === "-" ? "" : v.trim().replace(/\s+/g, " "));

/** RFC 4180 CSV, with quotes and newlines inside fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const COLS: Record<keyof Omit<FbRow, "phone" | "rawPhone"> | "phone", string[]> = {
  name: ["שם לקוח", "שם", "שם מלא", "name"],
  phone: ["טלפון", "טלפון נייד", "נייד", "phone", "mobile"],
  email: ["אימייל", "דוא\"ל", "מייל", "email"],
  created: ["נוצר בתאריך", "תאריך יצירה", "created"],
  updated: ["עודכן בתאריך", "תאריך עדכון"],
  owner: ["מנהל לקוח", "נציג", "סוכן", "owner"],
  status: ["סטטוס", "status"],
  source: ["מקור הגעה", "מקור", "source"],
  next: ["תאריך פעולה הבאה", "ת. פעולה הבאה", "פעולה הבאה"],
  ad: ["מודעה", "קמפיין", "campaign"],
};

function validDate(y: number, mo: number, d: number, hh: number, mm: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const date = new Date(y, mo - 1, d, hh, mm);
  // 31/02 would roll over into March: such a date is refused, not moved
  if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** "05/11/2026 14:30" (Fireberry's format, day first), also "5.11.2026", "5-11-2026" and ISO "2026-11-05". Israel time. Anything else is not guessed. */
export function parseFbDate(v: string): Date | null {
  const s = v.trim();
  if (!s || s === "-") return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return validDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1], m[4] ? +m[4] : 10, m[5] ? +m[5] : 0);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3], iso[4] ? +iso[4] : 10, iso[5] ? +iso[5] : 0);
  return null;
}

export function readFireberry(text: string): { rows: FbRow[]; headers: string[]; missing: string[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], headers: [], missing: ["name", "phone"] };
  const headers = table[0].map((h) => h.trim());
  const idx = (k: keyof typeof COLS) => headers.findIndex((h) => COLS[k].includes(h));
  const at = Object.fromEntries((Object.keys(COLS) as (keyof typeof COLS)[]).map((k) => [k, idx(k)])) as Record<keyof typeof COLS, number>;
  const get = (r: string[], k: keyof typeof COLS) => (at[k] >= 0 ? clean(r[at[k]] ?? "") : "");
  const rows = table.slice(1).map((r) => ({
    name: get(r, "name"),
    rawPhone: get(r, "phone"),
    phone: normalizePhone(get(r, "phone")),
    email: get(r, "email"),
    created: parseFbDate(get(r, "created")),
    updated: parseFbDate(get(r, "updated")),
    owner: get(r, "owner"),
    status: get(r, "status"),
    source: get(r, "source"),
    next: parseFbDate(get(r, "next")),
    ad: get(r, "ad"),
  }));
  const missing = (["name", "phone"] as const).filter((k) => at[k] < 0);
  return { rows, headers, missing };
}

/** Fireberry statuses → the new ones. "מכחיש פנייה" and similar become "לא רלוונטי" with a reason in our wording. */
export function mapStatus(s: string): { status: LeadStatus; reason: string | null } {
  const v = s.trim();
  const table: Record<string, LeadStatus> = {
    "חדש": "new",
    "בתהליך": "process",
    "אין מענה": "noans",
    "לתאם מחדש": "resched",
    "נקבעה פגישה": "meet",
    "מאושר להיום": "meet",
    "מאושר למחר": "meet",
    "התקיימה פגישה": "held",
    "המשך טיפול": "follow",
    "המשך טיפול לאחר פגישה": "follow",
    "אחרי המלחמה": "follow",
    "נחתמה עסקה": "won",
    "לא רלוונטי": "lost",
  };
  if (table[v]) return { status: table[v], reason: v === "לא רלוונטי" ? "אחר" : null };
  const lostReasons: Record<string, string> = {
    "מכחיש פנייה": "הכחשת פנייה",
    "הכחשת פנייה": "הכחשת פנייה",
    "לא מעוניין": "אין עניין",
    "לא מעוניינת": "אין עניין",
    "אין עניין": "אין עניין",
    "אין תקציב": "אין תקציב",
    "מספר לא תקין": "מספר לא תקין",
    "רכש במקום אחר": "רכישה במקום אחר",
    "רכישה במקום אחר": "רכישה במקום אחר",
  };
  if (lostReasons[v]) return { status: "lost", reason: lostReasons[v] };
  return { status: v ? "process" : "new", reason: null };
}

/** A first guess of the project from Fireberry's free-text source ("פייסבוק - אתונה" → אתונה). */
export function guessProject(source: string, projects: { id: string; name: string }[]): string {
  const s = source.replace(/\s+/g, " ");
  const rules: [RegExp, string][] = [
    [/אתונה|יוון|קיפסלי|חאניה/, "אתונה"],
    [/לימסול|קפריסין/, "לימסול"],
    [/מטרו רעננה|רעננה/, "מטרו רעננה"],
    [/מטרופארק|מטרו פארק/, "מטרופארק"],
    [/נופי הירקון|הירקון/, "נופי הירקון"],
    [/בן יהודה|כפר סבא/, "בן יהודה צפון"],
  ];
  for (const [re, name] of rules) if (re.test(s)) return projects.find((p) => p.name === name)?.id ?? "";
  return "";
}

// ---------------------------------------------------------------- meetings

/** A meeting from Fireberry's meetings export. "משויך ל" is only the client's name: there is no phone. */
export type FbMeeting = { start: Date | null; subject: string; client: string; status: string; rep: string; source: string; updated: Date | null };

const MEETING_COLS: Record<keyof FbMeeting, string[]> = {
  start: ["תאריך התחלה", "מועד התחלה", "תאריך ושעת התחלה"],
  subject: ["נושא", "כותרת"],
  client: ["משויך ל", "לקוח", "שם לקוח"],
  status: ["סטטוס", "סטטוס פגישה"],
  rep: ["שם נציג", "נציג", "בעלים"],
  source: ["מקור הגעה (משויך ל:לקוח)", "מקור הגעה"],
  updated: ["עודכן בתאריך", "תאריך עדכון"],
};

/** Which Fireberry export a file is, by its columns: meetings have a start time and who they are with. */
export function fireberryKind(headers: string[]): "leads" | "meetings" | null {
  const h = new Set(headers.map((x) => x.trim()));
  const has = (names: string[]) => names.some((n) => h.has(n));
  if (has(MEETING_COLS.start) && has(MEETING_COLS.client)) return "meetings";
  if (has(COLS.name) || has(COLS.phone)) return "leads";
  return null;
}

export function readFireberryMeetings(text: string): FbMeeting[] {
  const table = parseCsv(text);
  if (!table.length) return [];
  const headers = table[0].map((h) => h.trim());
  const at = Object.fromEntries((Object.keys(MEETING_COLS) as (keyof FbMeeting)[]).map((k) => [k, headers.findIndex((h) => MEETING_COLS[k].includes(h))])) as Record<keyof FbMeeting, number>;
  const get = (r: string[], k: keyof FbMeeting) => (at[k] >= 0 ? clean(r[at[k]] ?? "") : "");
  return table.slice(1).map((r) => ({
    start: parseFbDate(get(r, "start")),
    subject: get(r, "subject"),
    client: get(r, "client"),
    status: get(r, "status"),
    rep: get(r, "rep"),
    source: get(r, "source"),
    updated: parseFbDate(get(r, "updated")),
  }));
}

/** Fireberry meeting statuses → set / cancel / held. Anything unknown stays "נקבעה", so a past one shows up under "לסמן מה קרה". */
export function mapMeetingStatus(s: string): MeetingStatus {
  const v = s.trim().replace(/\s+/g, " ");
  if (v === "התקימה" || v === "התקיימה" || v === "בוצעה" || v === "הושלמה" || v === "המשך טיפול לאחר פגישה" || /^נקבעה פגישה שני/.test(v)) return "held";
  if (/בוטל|לא הגיע|הבריז|נדח/.test(v)) return "cancel";
  return "set";
}

/** The same meeting in two exports gets the same key, so importing again never doubles it. */
export function meetingKey(m: { client: string; start: Date; rep?: string; subject?: string }): string {
  const base = legacyMeetingKey(m);
  // meetings with no client are told apart by their rep and subject as well
  return m.client ? base : `${base}|${(m.rep ?? "").toLowerCase()}|${(m.subject ?? "").toLowerCase()}`;
}

/** The key the first version of the import gave every meeting (still used for meetings with a client). */
export function legacyMeetingKey(m: { client: string; start: Date }): string {
  return "fb:" + m.client.toLowerCase() + "|" + m.start.toISOString().slice(0, 16);
}

/** One lead row of one export: the same row in another file, or the same file again, gets the same key. */
export function leadRowKey(r: { phone: string | null; created: Date | null; source: string }): string {
  return `fb:${r.phone ?? ""}|${r.created ? r.created.toISOString().slice(0, 16) : ""}|${r.source.toLowerCase()}`;
}

/** A cautious first guess of the project from the meeting's subject. Unclear subjects stay without a project. */
export function guessMeetingProject(subject: string, projects: { id: string; name: string }[]): string {
  const s = subject.replace(/\s+/g, " ");
  const id = (name: string) => projects.find((p) => p.name === name)?.id ?? "";
  if (/אתונה|דפני|אמוניה|גאזי|מוזיאון|ויקטוריה|קיפסלי/.test(s)) return id("אתונה");
  if (/לימסול/.test(s)) return id("לימסול");
  if (/נופי הירקון/.test(s)) return id("נופי הירקון");
  if (/בן יהודה/.test(s)) return id("בן יהודה צפון");
  if (/מטרופארק|מטרו פארק/.test(s)) return id("מטרופארק");
  if (/מטרו/.test(s)) {
    const pt = /פ"ת|פ''ת|פתח ת|(^|\s)פת(\s|$)/.test(s);
    const ra = /רעננה/.test(s);
    if (pt && !ra) return id("מטרופארק");
    if (ra && !pt) return id("מטרו רעננה");
  }
  return "";
}
