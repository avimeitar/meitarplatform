// Lead intake from outside systems: the website, landing pages, lead vendors, and Facebook or Instagram
// Lead Ads through Make or Zapier. Nothing here touches the database: the API key format, reading the
// request body and mapping the field names people send. The route (src/app/api/v1/leads) and the tests share it.
// Messages are in English: they are read by the integrators who connect to the API.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "./phone";

// ---------------------------------------------------------------- API keys

/** A new key, "mk_<prefix>_<secret>". Only the prefix (to find the row) and a SHA-256 hash of the whole key are stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(5).toString("hex");
  const secret = randomBytes(24).toString("hex");
  const key = `mk_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const KEY_RE = /^mk_([a-z0-9]{6,32})_([A-Za-z0-9]{16,200})$/;

/** The prefix of a well-formed key, or null. */
export function parseApiKey(key: string): string | null {
  return KEY_RE.exec(key)?.[1] ?? null;
}

/** Compares the key's hash with the stored hash in constant time. */
export function apiKeyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** How a key is shown once it was created: the prefix only. */
export function maskedKey(prefix: string): string {
  return `mk_${prefix}_…`;
}

/** The key from "Authorization: Bearer <key>" or "X-Api-Key: <key>". */
export function apiKeyFromHeaders(h: { get(name: string): string | null }): string | null {
  const auth = h.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (bearer) return bearer;
  if (auth.startsWith("mk_")) return auth;
  return h.get("x-api-key")?.trim() || null;
}

// ---------------------------------------------------------------- rate limit

/** A sliding one-minute window per key, kept in memory. Each server instance counts on its own. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  hit(id: string): { ok: true } | { ok: false; retryAfter: number } {
    const t = this.now();
    const recent = (this.hits.get(id) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(id, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + this.windowMs - t) / 1000)) };
    }
    recent.push(t);
    this.hits.set(id, recent);
    return { ok: true };
  }
}

// ---------------------------------------------------------------- request body

export const MAX_BODY_BYTES = 100 * 1024;

export type Body = Record<string, unknown>;
export type BodyResult = { ok: true; data: Body } | { ok: false; status: 400 | 413 | 415; error: string };

const HOW = 'Send JSON with "Content-Type: application/json", or a form with "Content-Type: application/x-www-form-urlencoded".';

function isObject(v: unknown): v is Body {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads a JSON, urlencoded or multipart body into a plain object (the inquiry keeps it as it came). */
export async function readLeadBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const contentType = req.headers.get("content-type") ?? "";
  const type = contentType.split(";")[0].trim().toLowerCase();
  const tooLarge: BodyResult = { ok: false, status: 413, error: `The request body is too large. The limit is ${Math.round(maxBytes / 1024)} KB per lead.` };
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  const bytes = await readBytes(req, maxBytes);
  if (!bytes) return tooLarge;

  if (type === "multipart/form-data") {
    try {
      const fd = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
      return done(fromEntries(fd.entries()));
    } catch {
      return { ok: false, status: 400, error: "Could not read the multipart form body." };
    }
  }
  const json = type === "application/json" || type === "text/json" || type.endsWith("+json");
  const form = type === "application/x-www-form-urlencoded";
  const unknownType = type === "" || type === "text/plain"; // some tools send JSON without saying so
  if (!json && !form && !unknownType) return { ok: false, status: 415, error: `Unsupported content type "${type}". ${HOW}` };

  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return { ok: false, status: 400, error: `The request body is empty. ${HOW}` };
  if (json || (unknownType && /^[[{]/.test(text))) return parseJson(text);
  if (form || text.includes("=")) return done(fromEntries(new URLSearchParams(text).entries()));
  return { ok: false, status: 400, error: `Could not read the request body. ${HOW}` };
}

async function readBytes(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function parseJson(text: string): BodyResult {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err) {
    return { ok: false, status: 400, error: `The request body is not valid JSON (${err instanceof Error ? err.message : "parse error"}).` };
  }
  if (Array.isArray(v)) return { ok: false, status: 400, error: "Send one lead per request: the JSON body must be an object, not a list." };
  if (!isObject(v)) return { ok: false, status: 400, error: 'The JSON body must be an object with the lead\'s fields, for example {"name": "Dana Levi", "phone": "050-1234567"}.' };
  return done(v);
}

/** Form fields as an object. A field sent more than once becomes a list; uploaded files are left out. */
function fromEntries(entries: Iterable<[string, unknown]>): Body {
  const out: Body = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || k === "__proto__") continue;
    if (!Object.hasOwn(out, k)) out[k] = v;
    else out[k] = Array.isArray(out[k]) ? [...(out[k] as unknown[]), v] : [out[k], v];
  }
  return out;
}

function done(data: Body): BodyResult {
  return { ok: true, data: cleanPayload(data) as Body };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const cleanText = (s: string) => s.replace(/\u0000/g, "").replace(LONE_SURROGATE, "�");

/** PostgreSQL refuses NUL characters and broken surrogate pairs in text and JSON, so they are removed. Very deep nesting is cut. */
export function cleanPayload(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return cleanText(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || typeof v === "boolean") return v;
  if (depth >= 20) return null;
  if (Array.isArray(v)) return v.map((x) => cleanPayload(x, depth + 1));
  if (isObject(v)) {
    const out: Body = {};
    for (const [k, x] of Object.entries(v)) if (k !== "__proto__") out[cleanText(k)] = cleanPayload(x, depth + 1);
    return out;
  }
  return null;
}

// ---------------------------------------------------------------- field names

/** The name a lead gets when the sender did not include one. */
export const NO_NAME = "ללא שם";

// Field names after normKey(), in order of preference. Hebrew names come from forms built in Hebrew.
const ALIASES = {
  name: ["name", "full_name", "fullname", "your_name", "client_name", "customer_name", "contact_name", "lead_name", "שם", "שם_מלא", "השם", "שם_הלקוח", "שם_ושם_משפחה"],
  first: ["first_name", "firstname", "fname", "given_name", "שם_פרטי"],
  last: ["last_name", "lastname", "lname", "surname", "family_name", "שם_משפחה"],
  phone: ["phone", "phone_number", "phonenumber", "tel", "telephone", "mobile", "mobile_phone", "mobile_number", "cell", "cellphone", "cell_phone", "your_phone", "your_tel", "טלפון", "מספר_טלפון", "טלפון_נייד", "נייד", "פלאפון", "סלולרי"],
  email: ["email", "e_mail", "email_address", "mail", "your_email", "אימייל", "מייל", "דואל", "דוא_ל", "דואר_אלקטרוני", "כתובת_מייל"],
  project: ["project", "project_name", "project_id", "פרויקט", "פרוייקט", "שם_הפרויקט"],
  source: ["source", "lead_source", "מקור", "מקור_הגעה", "מקור_הליד"],
  campaign: ["campaign", "utm_campaign", "campaign_name", "קמפיין"],
  page: ["page", "page_url", "url", "landing_page", "landing_page_url", "form_url", "source_url", "עמוד", "דף", "דף_נחיתה", "form_name"],
  consent: ["consent", "marketing_consent", "marketing", "opt_in", "optin", "accept_marketing", "newsletter", "הסכמה", "הסכמה_לדיוור", "אישור_דיוור", "דיוור"],
};
type Field = keyof typeof ALIASES;

/** Shown on the settings screen, for whoever connects a system. */
export const FIELD_DOCS: { field: string; label: string; also: string[]; required?: boolean }[] = [
  { field: "phone", label: "טלפון. חובה. ישראלי (050-1234567) או בינלאומי עם קידומת מדינה", also: ["phone_number", "tel", "mobile", "טלפון"], required: true },
  { field: "name", label: "שם מלא", also: ["full_name", "first_name + last_name", "שם"] },
  { field: "email", label: "אימייל", also: ["email_address", "אימייל"] },
  { field: "project", label: "שם הפרויקט או המזהה שלו. בלי פרויקט, נכנס הפרויקט של המפתח", also: ["project_name", "פרויקט"] },
  { field: "source", label: "מקור. בלי מקור, נכנס המקור של המפתח", also: ["lead_source", "מקור"] },
  { field: "campaign", label: "קמפיין", also: ["utm_campaign", "campaign_name"] },
  { field: "page", label: "הדף או הטופס שממנו נשלח הליד", also: ["page_url", "url", "form_name"] },
  { field: "consent", label: "הסכמה לקבל דיוור: true, ‏on או 1", also: ["marketing_consent", "הסכמה"] },
];

/** "Full Name", "full-name" and "fullName" all become "full_name". Hebrew letters stay as they are. */
export function normKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/** A value as text: trimmed, with spaces collapsed. Lists give their first value; {"value": ...} objects their value. */
function text(v: unknown): string | null {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = text(x);
      if (t) return t;
    }
    return null;
  }
  if (isObject(v) && "value" in v) return text(v.value);
  return null;
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);

/** Every field the body carries, by normalized name. The top level wins over nested places. */
function collect(body: Body): Map<string, unknown> {
  const m = new Map<string, unknown>();
  const add = (k: string, v: unknown) => {
    const n = normKey(k);
    if (n && !m.has(n) && text(v) !== null) m.set(n, v);
  };
  for (const [k, v] of Object.entries(body)) add(k, v);
  // Facebook Lead Ads, as the Graph API sends a lead: field_data: [{ name: "full_name", values: ["Dana Levi"] }]
  if (Array.isArray(body.field_data)) {
    for (const f of body.field_data) if (isObject(f) && typeof f.name === "string") add(f.name, f.values ?? f.value);
  }
  // senders that wrap the lead: { "lead": {...} }, { "data": {...} }, { "contact": {...} }, { "fields": {...} }
  for (const c of ["lead", "data", "contact", "fields"]) {
    const inner = body[c];
    if (isObject(inner)) for (const [k, v] of Object.entries(inner)) add(k, v);
  }
  return m;
}

const TRUE_WORDS = new Set(["true", "on", "1", "yes", "y", "checked", "agree", "agreed", "accept", "accepted", "ok", "כן", "מאשר", "מאשרת", "מסכים", "מסכימה"]);

/** Consent counts only when it is clearly given: a false or unknown value means no consent. */
function given(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(given);
  const t = text(v);
  return !!t && TRUE_WORDS.has(t.toLowerCase());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IntakeLead = {
  name: string | null;
  phone: string; // E.164
  email: string | null;
  project: string | null; // a project id or name, resolved by the route
  source: string | null;
  campaign: string | null;
  page: string | null;
  consent: boolean;
};

export type MapResult = { ok: true; lead: IntakeLead; warnings: string[] } | { ok: false; error: string };

/** Finds the lead's details in whatever field names the sender used. */
export function mapLeadFields(body: Body): MapResult {
  const m = collect(body);
  const raw = (f: Field): unknown => {
    for (const a of ALIASES[f]) if (m.has(a)) return m.get(a);
    return undefined;
  };
  const pick = (f: Field, max: number): string | null => {
    const t = text(raw(f));
    return t ? clip(t, max) : null;
  };
  const warnings: string[] = [];

  const phoneText = pick("phone", 100);
  if (!phoneText) return { ok: false, error: 'Missing phone number. Send it in the "phone" field (also accepted: phone_number, tel, mobile, טלפון).' };
  const phone = normalizePhone(phoneText);
  if (!phone) {
    return { ok: false, error: `The phone number "${clip(phoneText, 40)}" is not valid. Send an Israeli number such as 050-1234567, or an international number with its country code, such as +44 20 7946 0958.` };
  }

  const name = pick("name", 120) ?? (clip([pick("first", 60), pick("last", 60)].filter(Boolean).join(" "), 120) || null);

  let email = pick("email", 200);
  if (email && !EMAIL_RE.test(email)) {
    warnings.push(`The email "${clip(email, 60)}" is not valid, so it was not saved on the lead (it is kept with the inquiry's data).`);
    email = null;
  }

  return {
    ok: true,
    lead: {
      name,
      phone,
      email,
      project: pick("project", 200),
      source: pick("source", 60),
      campaign: pick("campaign", 200),
      page: pick("page", 500),
      consent: given(raw("consent")),
    },
    warnings,
  };
}
