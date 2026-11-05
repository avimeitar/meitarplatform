// Reading lead exports from Fireberry (CSV, Hebrew headers) for the one-time move to the new system.
import type { LeadStatus } from "./crm/constants";
import { normalizePhone } from "./phone";

export type FbRow = { name: string; phone: string | null; rawPhone: string; email: string; created: Date | null; owner: string; status: string; source: string; next: Date | null; ad: string };

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
  owner: ["מנהל לקוח", "נציג", "סוכן", "owner"],
  status: ["סטטוס", "status"],
  source: ["מקור הגעה", "מקור", "source"],
  next: ["תאריך פעולה הבאה", "ת. פעולה הבאה", "פעולה הבאה"],
  ad: ["מודעה", "קמפיין", "campaign"],
};

/** "05/11/2026 14:30" (Fireberry's format), also "5.11.2026" and ISO. Local (Israel) time. */
export function parseFbDate(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const d = new Date(y, +m[2] - 1, +m[1], m[4] ? +m[4] : 10, m[5] ? +m[5] : 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function readFireberry(text: string): { rows: FbRow[]; headers: string[]; missing: string[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], headers: [], missing: ["name", "phone"] };
  const headers = table[0].map((h) => h.trim());
  const idx = (k: keyof typeof COLS) => headers.findIndex((h) => COLS[k].includes(h));
  const at = Object.fromEntries((Object.keys(COLS) as (keyof typeof COLS)[]).map((k) => [k, idx(k)])) as Record<keyof typeof COLS, number>;
  const get = (r: string[], k: keyof typeof COLS) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
  const rows = table.slice(1).map((r) => ({
    name: get(r, "name"),
    rawPhone: get(r, "phone"),
    phone: normalizePhone(get(r, "phone")),
    email: get(r, "email"),
    created: parseFbDate(get(r, "created")),
    owner: get(r, "owner"),
    status: get(r, "status"),
    source: get(r, "source"),
    next: parseFbDate(get(r, "next")),
    ad: get(r, "ad"),
  }));
  const missing = (["name", "phone"] as const).filter((k) => at[k] < 0);
  return { rows, headers, missing };
}

/** Fireberry statuses → the new ones. "מכחיש פנייה" and similar become "לא רלוונטי" with that reason. */
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
  const lostReasons = ["מכחיש פנייה", "לא מעוניין", "אין תקציב", "מספר לא תקין", "רכש במקום אחר"];
  if (lostReasons.includes(v)) return { status: "lost", reason: v };
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
