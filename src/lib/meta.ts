// Facebook and Instagram Lead Ads, straight from Meta: the app's settings, signing in to connect a page, the
// webhook's checks, and the Graph API calls that read a lead. Nothing here touches our database; metaLeads.ts does.
//
// Railway variables (set by whoever creates the Meta app; see docs/META_SETUP.md):
//   META_APP_ID, META_APP_SECRET      the Meta app
//   META_LOGIN_CONFIG_ID              a "Facebook Login for Business" configuration (optional: without it, permissions are asked by name)
//   META_GRAPH_VERSION                optional, e.g. "v23.0"
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appBaseURL } from "./auth";

/** What the system asks for when a page is connected: list the pages, subscribe one to leads, and read its leads. */
export const META_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval"];

export type MetaConfig = { appId: string; appSecret: string; configId: string | null; graph: string };

export function metaConfig(): MetaConfig | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const v = process.env.META_GRAPH_VERSION?.trim();
  return { appId, appSecret, configId: process.env.META_LOGIN_CONFIG_ID?.trim() || null, graph: v && /^v\d+\.\d+$/.test(v) ? v : "v23.0" };
}

/** The addresses Meta needs, to be entered in the app's settings. */
export function metaUrls() {
  const base = appBaseURL();
  return { webhook: `${base}/api/meta/webhook`, callback: `${base}/api/meta/callback`, privacy: `${base}/privacy`, deletion: `${base}/data-deletion`, domain: new URL(base).host };
}

const secret = () => process.env.BETTER_AUTH_SECRET || "";

/** The word Meta sends back when the webhook is set up. Made from the system's own secret, so nothing else to keep. */
export function metaVerifyToken(): string {
  return createHmac("sha256", secret()).update("meta-webhook-verify").digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------- page tokens, encrypted at rest

const key = () => createHash("sha256").update(secret() + ":meta-page-token").digest();

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openToken(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("not a sealed token");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- the webhook

/** Meta signs each delivery with the app secret: "sha256=<hex>" over the raw body. */
export function signatureOk(raw: string, header: string | null, appSecret: string): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!m) return false;
  const want = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export type LeadgenChange = { leadgenId: string; pageId: string; formId: string | null; createdTime: number | null };

/** The new leads in a webhook delivery. The delivery only says a lead exists; its details are read separately. */
export function leadgenChanges(body: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const b = body as { object?: string; entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (b?.object !== "page" || !Array.isArray(b.entry)) return out;
  for (const e of b.entry) {
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      if (c?.field !== "leadgen" || !c.value) continue;
      const v = c.value;
      const leadgenId = String(v.leadgen_id ?? "");
      const pageId = String(v.page_id ?? e.id ?? "");
      if (!/^\d+$/.test(leadgenId) || !/^\d+$/.test(pageId)) continue;
      out.push({ leadgenId, pageId, formId: v.form_id ? String(v.form_id) : null, createdTime: typeof v.created_time === "number" ? v.created_time : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the Graph API

export class MetaError extends Error {
  code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.code = code;
  }
}

const proof = (token: string, appSecret: string) => createHmac("sha256", appSecret).update(token).digest("hex");

export async function graph<T>(cfg: MetaConfig, path: string, token: string | null, params: Record<string, string> = {}, method: "GET" | "POST" | "DELETE" = "GET"): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${cfg.graph}/${path.replace(/^\//, "")}`);
  const q = new URLSearchParams(params);
  if (token) {
    q.set("access_token", token);
    q.set("appsecret_proof", proof(token, cfg.appSecret));
  }
  let res: Response;
  if (method === "GET") {
    url.search = q.toString();
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } else {
    res = await fetch(url, { method, body: q, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!res.ok || !data || data.error) throw new MetaError(data?.error?.message || `Facebook answered ${res.status}`, data?.error?.code ?? null);
  return data;
}

/** Where people sign in to Facebook to connect pages. */
export function loginUrl(cfg: MetaConfig, state: string): string {
  const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: metaUrls().callback, state, response_type: "code" });
  if (cfg.configId) q.set("config_id", cfg.configId);
  else q.set("scope", META_PERMISSIONS.join(","));
  return `https://www.facebook.com/${cfg.graph}/dialog/oauth?${q}`;
}

export type LoginPages = { pages: { id: string; name: string; token: string }[]; listed: number; granted: number; loaded: number; failures: string[] };

/**
 * The code from signing in → a long-lived user token → the pages, each with a token that does not expire.
 * /me/accounts lists the pages the person manages directly. A page they reach through a Business portfolio
 * (with Facebook Login for Business) can be missing from it, so the pages the person granted in the dialog are
 * also read from the token itself (debug_token's granular scopes), and each is asked for by its id.
 */
export async function pagesFromLogin(cfg: MetaConfig, code: string): Promise<LoginPages> {
  const short = await graph<{ access_token: string }>(cfg, "oauth/access_token", null, { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: metaUrls().callback, code });
  const long = await graph<{ access_token: string }>(cfg, "oauth/access_token", null, {
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: short.access_token,
  });
  const user = long.access_token;
  const found = new Map<string, { id: string; name: string; token: string }>();
  const failures: string[] = [];

  let listed = 0;
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await graph<{ data: { id: string; name: string; access_token?: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>(cfg, "me/accounts", user, {
      fields: "id,name,access_token",
      limit: "100",
      ...(after ? { after } : {}),
    });
    listed += r.data.length;
    for (const p of r.data) if (p.access_token) found.set(p.id, { id: p.id, name: p.name, token: p.access_token });
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }

  // the pages granted in the dialog, as the token itself says (an app token asks: no proof is sent for it)
  const granted = new Set<string>();
  try {
    const dbg = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(cfg, "debug_token", null, { input_token: user, access_token: `${cfg.appId}|${cfg.appSecret}` });
    for (const g of dbg.data?.granular_scopes ?? []) if (PAGE_SCOPES.includes(g.scope)) for (const id of g.target_ids ?? []) if (/^\d+$/.test(id)) granted.add(id);
  } catch (e) {
    failures.push(`debug_token: ${e instanceof MetaError ? `${e.code ?? ""} ${e.message}` : "failed"}`);
  }
  let loaded = 0;
  for (const id of granted) {
    if (found.has(id)) continue;
    try {
      const p = await graph<{ id: string; name?: string; access_token?: string }>(cfg, id, user, { fields: "id,name,access_token" });
      if (p.access_token) {
        found.set(p.id, { id: p.id, name: p.name || `עמוד ${p.id}`, token: p.access_token });
        loaded++;
      } else failures.push(`page ${id}: no page token`);
    } catch (e) {
      failures.push(`page ${id}: ${e instanceof MetaError ? `${e.code ?? ""} ${e.message}` : "failed"}`);
    }
  }
  return { pages: [...found.values()], listed, granted: granted.size, loaded, failures };
}

/** Permissions whose grant names the pages chosen in the dialog. */
const PAGE_SCOPES = ["pages_show_list", "pages_manage_metadata", "leads_retrieval", "pages_read_engagement", "pages_manage_ads"];

/** Leads from the page's forms reach this app's webhook. */
export const subscribePage = (cfg: MetaConfig, pageId: string, token: string) => graph<{ success: boolean }>(cfg, `${pageId}/subscribed_apps`, token, { subscribed_fields: "leadgen" }, "POST");
export const unsubscribePage = (cfg: MetaConfig, pageId: string, token: string) => graph<{ success: boolean }>(cfg, `${pageId}/subscribed_apps`, token, {}, "DELETE");

export type MetaLead = {
  id: string;
  created_time?: string;
  field_data?: { name: string; values?: string[] }[];
  form_id?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
};

const LEAD_FIELDS = "id,created_time,field_data,form_id,ad_id,ad_name,adset_name,campaign_id,campaign_name,platform,is_organic";
const LEAD_FIELDS_MIN = "id,created_time,field_data,form_id,platform,is_organic";

/** One lead's answers. The names of the ad and campaign need more access; without it, the answers alone. */
export async function fetchLead(cfg: MetaConfig, leadgenId: string, token: string): Promise<MetaLead> {
  try {
    return await graph<MetaLead>(cfg, leadgenId, token, { fields: LEAD_FIELDS });
  } catch (e) {
    if (e instanceof MetaError && (e.code === 100 || e.code === 200 || e.code === 10)) return graph<MetaLead>(cfg, leadgenId, token, { fields: LEAD_FIELDS_MIN });
    throw e;
  }
}

export async function pageForms(cfg: MetaConfig, pageId: string, token: string): Promise<{ id: string; name: string; status?: string }[]> {
  const out: { id: string; name: string; status?: string }[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await graph<{ data: { id: string; name: string; status?: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>(cfg, `${pageId}/leadgen_forms`, token, {
      fields: "id,name,status",
      limit: "100",
      ...(after ? { after } : {}),
    });
    out.push(...r.data);
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

/** A form's leads since a moment, newest pages first; at most a few thousand. */
export async function formLeads(cfg: MetaConfig, formId: string, token: string, since: Date): Promise<MetaLead[]> {
  const out: MetaLead[] = [];
  let after: string | undefined;
  const filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) }]);
  for (let i = 0; i < 40; i++) {
    let r: { data: MetaLead[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      r = await graph(cfg, `${formId}/leads`, token, { fields: LEAD_FIELDS, filtering, limit: "100", ...(after ? { after } : {}) });
    } catch (e) {
      if (!(e instanceof MetaError && (e.code === 100 || e.code === 200 || e.code === 10)) || i > 0) throw e;
      r = await graph(cfg, `${formId}/leads`, token, { fields: LEAD_FIELDS_MIN, filtering, limit: "100" });
    }
    out.push(...r.data);
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

/** A lead's answers as the fields our intake understands: full_name, phone_number, email, and any custom question. */
export function leadFields(lead: Pick<MetaLead, "field_data">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of lead.field_data ?? []) {
    if (!f?.name || f.name === "__proto__") continue;
    out[f.name] = (f.values ?? []).filter((v) => typeof v === "string").join(", ");
  }
  return out;
}
