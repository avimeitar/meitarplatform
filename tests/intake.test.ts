import { describe, expect, it } from "vitest";
import {
  apiKeyFromHeaders,
  apiKeyMatches,
  cleanPayload,
  generateApiKey,
  hashApiKey,
  mapLeadFields,
  maskedKey,
  normKey,
  parseApiKey,
  RateLimiter,
  readLeadBody,
  type Body,
} from "../src/lib/intake";

const URL = "http://localhost/api/v1/leads";

function post(body: BodyInit | null, contentType?: string, headers: Record<string, string> = {}) {
  return new Request(URL, { method: "POST", body, headers: { ...(contentType ? { "content-type": contentType } : {}), ...headers } });
}

function mapped(body: Body) {
  const r = mapLeadFields(body);
  if (!r.ok) throw new Error("expected a lead, got: " + r.error);
  return r;
}

describe("API keys", () => {
  it("generates mk_<prefix>_<secret> keys that parse and match their hash", () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^mk_[0-9a-f]{10}_[0-9a-f]{48}$/);
    expect(parseApiKey(k.key)).toBe(k.prefix);
    expect(k.hash).toBe(hashApiKey(k.key));
    expect(apiKeyMatches(k.key, k.hash)).toBe(true);
    expect(maskedKey(k.prefix)).toBe(`mk_${k.prefix}_…`);
  });

  it("never repeats a key", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
    expect(keys.size).toBe(200);
  });

  it("rejects a key with a wrong secret, and malformed keys", () => {
    const k = generateApiKey();
    const wrong = `mk_${k.prefix}_${"0".repeat(48)}`;
    expect(parseApiKey(wrong)).toBe(k.prefix);
    expect(apiKeyMatches(wrong, k.hash)).toBe(false);
    expect(apiKeyMatches(k.key, "not-a-hash")).toBe(false);
    for (const bad of ["", "mk_", "mk_abc", "sk_live_123", `mk_${k.prefix}`, `MK_${k.prefix}_${"a".repeat(48)}`, `mk_ab_cd_${"a".repeat(48)}`]) expect(parseApiKey(bad)).toBeNull();
  });

  it("reads the key from Authorization: Bearer or X-Api-Key", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(apiKeyFromHeaders(h({ Authorization: "Bearer mk_a" }))).toBe("mk_a");
    expect(apiKeyFromHeaders(h({ authorization: "bearer   mk_b " }))).toBe("mk_b");
    expect(apiKeyFromHeaders(h({ "X-Api-Key": "mk_c" }))).toBe("mk_c");
    expect(apiKeyFromHeaders(h({ Authorization: "mk_d" }))).toBe("mk_d");
    expect(apiKeyFromHeaders(h({ Authorization: "Basic dXNlcjpwYXNz", "x-api-key": "mk_e" }))).toBe("mk_e");
    expect(apiKeyFromHeaders(h({}))).toBeNull();
    expect(apiKeyFromHeaders(h({ Authorization: "Bearer " }))).toBeNull();
  });
});

describe("rate limit", () => {
  it("allows 120 requests a minute per key, then asks to wait", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(120, 60_000, () => now);
    for (let i = 0; i < 120; i++) expect(rl.hit("k1").ok).toBe(true);
    const blocked = rl.hit("k1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(60);
    expect(rl.hit("k2").ok).toBe(true); // other keys are counted apart
    now += 30_000;
    expect(rl.hit("k1").ok).toBe(false);
    now += 30_001;
    expect(rl.hit("k1").ok).toBe(true);
  });
});

describe("reading the body", () => {
  it("reads JSON", async () => {
    const r = await readLeadBody(post(JSON.stringify({ name: "דנה לוי", phone: "050-1234567", extra: { a: [1, 2] } }), "application/json; charset=utf-8"));
    expect(r).toEqual({ ok: true, data: { name: "דנה לוי", phone: "050-1234567", extra: { a: [1, 2] } } });
  });

  it("reads urlencoded forms, with Hebrew and repeated fields", async () => {
    const form = new URLSearchParams([["שם", "דנה לוי"], ["טלפון", "0501234567"], ["interest", "a"], ["interest", "b"]]);
    const r = await readLeadBody(post(form.toString(), "application/x-www-form-urlencoded"));
    expect(r).toEqual({ ok: true, data: { שם: "דנה לוי", טלפון: "0501234567", interest: ["a", "b"] } });
  });

  it("reads multipart forms and leaves files out", async () => {
    const fd = new FormData();
    fd.set("full_name", "Dana Levi");
    fd.set("phone_number", "+972501234567");
    fd.set("cv", new Blob(["file"]), "cv.txt");
    const req = new Request(URL, { method: "POST", body: fd });
    const r = await readLeadBody(req);
    expect(r).toEqual({ ok: true, data: { full_name: "Dana Levi", phone_number: "+972501234567" } });
  });

  it("guesses the format when the content type is missing or text/plain", async () => {
    expect(await readLeadBody(post(JSON.stringify({ phone: "0501234567" }), "text/plain"))).toEqual({ ok: true, data: { phone: "0501234567" } });
    const noType = new Request(URL, { method: "POST", body: new TextEncoder().encode("phone=0501234567&name=Dana") });
    expect(noType.headers.get("content-type")).toBeNull();
    expect(await readLeadBody(noType)).toEqual({ ok: true, data: { phone: "0501234567", name: "Dana" } });
  });

  it("explains what is wrong with a bad body", async () => {
    const empty = await readLeadBody(post("", "application/json"));
    expect(empty).toMatchObject({ ok: false, status: 400 });
    if (!empty.ok) expect(empty.error).toMatch(/empty/);

    const broken = await readLeadBody(post('{"name": "Dana",', "application/json"));
    expect(broken).toMatchObject({ ok: false, status: 400 });
    if (!broken.ok) expect(broken.error).toMatch(/not valid JSON/);

    const list = await readLeadBody(post('[{"phone":"0501234567"}]', "application/json"));
    expect(list).toMatchObject({ ok: false, status: 400 });
    if (!list.ok) expect(list.error).toMatch(/one lead per request/);

    expect(await readLeadBody(post('"just a string"', "application/json"))).toMatchObject({ ok: false, status: 400 });
    expect(await readLeadBody(post("<lead/>", "application/xml"))).toMatchObject({ ok: false, status: 415 });
    expect(await readLeadBody(post("hello", "text/plain"))).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses bodies over the size limit", async () => {
    const big = JSON.stringify({ phone: "0501234567", note: "x".repeat(2000) });
    expect(await readLeadBody(post(big, "application/json"), 1000)).toMatchObject({ ok: false, status: 413 });
    expect(await readLeadBody(post(big, "application/json"), 10_000)).toMatchObject({ ok: true });
  });

  it("removes characters PostgreSQL cannot store", async () => {
    const r = await readLeadBody(post('{"name":"Da\\u0000na","note":"\\ud800x","__proto__":{"admin":true}}', "application/json"));
    expect(r).toEqual({ ok: true, data: { name: "Dana", note: "�x" } });
    expect(cleanPayload({ a: { b: { c: 1 } } })).toEqual({ a: { b: { c: 1 } } });
    let deep: unknown = "end";
    for (let i = 0; i < 40; i++) deep = { d: deep };
    expect(JSON.stringify(cleanPayload(deep))).not.toContain("end");
  });
});

describe("field names", () => {
  it("normalizes names the way senders write them", () => {
    expect(normKey("Full Name")).toBe("full_name");
    expect(normKey("fullName")).toBe("full_name");
    expect(normKey("phone-number")).toBe("phone_number");
    expect(normKey("E-mail")).toBe("e_mail");
    expect(normKey("UTM_Campaign")).toBe("utm_campaign");
    expect(normKey("pageURL")).toBe("page_url");
    expect(normKey(" שם מלא: ")).toBe("שם_מלא");
    expect(normKey("דוא״ל")).toBe("דוא_ל");
  });

  it("maps the standard names", () => {
    const r = mapped({
      name: "  Dana   Levi ",
      phone: "050-123-4567",
      email: "dana@example.com",
      project: "מטרו רעננה",
      source: "פייסבוק",
      campaign: "spring",
      page: "https://meitargroup.co.il/metro",
      consent: true,
    });
    expect(r.lead).toEqual({
      name: "Dana Levi",
      phone: "+972501234567",
      email: "dana@example.com",
      project: "מטרו רעננה",
      source: "פייסבוק",
      campaign: "spring",
      page: "https://meitargroup.co.il/metro",
      consent: true,
    });
    expect(r.warnings).toEqual([]);
  });

  it("maps the names Zapier and Make use for Facebook leads", () => {
    const r = mapped({ "Full Name": "Dana Levi", "Phone Number": "+972 52-765-4321", Email: "d@example.com", campaign_name: "Metro FB", form_name: "Metro form", platform: "ig" });
    expect(r.lead).toMatchObject({ name: "Dana Levi", phone: "+972527654321", email: "d@example.com", campaign: "Metro FB", page: "Metro form", consent: false });
  });

  it("joins first and last names", () => {
    expect(mapped({ first_name: "Dana", last_name: "Levi", tel: "0501234567" }).lead.name).toBe("Dana Levi");
    expect(mapped({ firstName: "Dana", mobile: "0501234567" }).lead.name).toBe("Dana");
    expect(mapped({ full_name: "Dana Levi", first_name: "X", phone: "0501234567" }).lead.name).toBe("Dana Levi");
  });

  it("maps Hebrew field names", () => {
    const r = mapped({ "שם פרטי": "דנה", "שם משפחה": "לוי", "טלפון נייד": "052-7654321", "אימייל": "dana@example.co.il", "פרויקט": "אתונה", "מקור": "אתר החברה", "קמפיין": "חורף", "הסכמה": "כן" });
    expect(r.lead).toEqual({ name: "דנה לוי", phone: "+972527654321", email: "dana@example.co.il", project: "אתונה", source: "אתר החברה", campaign: "חורף", page: null, consent: true });
    expect(mapped({ "שם מלא": "דנה לוי", "טלפון": "0501234567", "דוא״ל": "d@example.com" }).lead).toMatchObject({ name: "דנה לוי", email: "d@example.com" });
  });

  it("reads Facebook's field_data and wrapped leads", () => {
    const fb = mapped({
      id: "1234567890",
      created_time: "2026-11-05T10:00:00+0000",
      field_data: [
        { name: "full_name", values: ["Dana Levi"] },
        { name: "phone_number", values: ["+972501234567"] },
        { name: "email", values: ["dana@example.com"] },
      ],
    });
    expect(fb.lead).toMatchObject({ name: "Dana Levi", phone: "+972501234567", email: "dana@example.com" });
    expect(mapped({ lead: { name: "Dana", phone: "0501234567" }, source: "ספק X" }).lead).toMatchObject({ name: "Dana", phone: "+972501234567", source: "ספק X" });
    expect(mapped({ data: { fullName: "Dana", phoneNumber: "0501234567" } }).lead).toMatchObject({ name: "Dana", phone: "+972501234567" });
    // the top level wins over the nested values
    expect(mapped({ phone: "0501234567", lead: { phone: "0529999999" } }).lead.phone).toBe("+972501234567");
  });

  it("takes utm_campaign and page_url", () => {
    const r = mapped({ phone: "0501234567", utm_campaign: "metro-nov", utm_source: "facebook", page_url: "https://meitargroup.co.il/x?utm_campaign=metro-nov" });
    expect(r.lead).toMatchObject({ campaign: "metro-nov", page: "https://meitargroup.co.il/x?utm_campaign=metro-nov", source: null });
  });

  it("accepts phone numbers in common forms", () => {
    for (const p of ["0501234567", "050-1234567", "+972501234567", "972501234567", "00972501234567", 501234567, ["", "050 123 4567"]]) {
      expect(mapped({ phone: p }).lead.phone).toBe("+972501234567");
    }
    expect(mapped({ phone: "+44 20 7946 0958" }).lead.phone).toBe("+442079460958");
  });

  it("needs a valid phone number", () => {
    const missing = mapLeadFields({ name: "Dana", email: "dana@example.com" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/Missing phone number/);
    expect(mapLeadFields({ name: "Dana", phone: "   " }).ok).toBe(false);
    const bad = mapLeadFields({ name: "Dana", phone: "12345" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/"12345" is not valid/);
  });

  it("drops an invalid email with a warning instead of losing the lead", () => {
    const r = mapped({ phone: "0501234567", email: "not-an-email" });
    expect(r.lead.email).toBeNull();
    expect(r.warnings[0]).toMatch(/not valid/);
  });

  it("leaves the name empty when none was sent", () => {
    expect(mapped({ phone: "0501234567" }).lead.name).toBeNull();
  });

  it("counts consent only when it is clearly given", () => {
    for (const v of [true, "true", "on", "1", 1, "yes", "Yes", "כן", ["on"]]) expect(mapped({ phone: "0501234567", consent: v }).lead.consent).toBe(true);
    for (const v of [false, "false", "off", "0", 0, "no", "לא", "", "maybe"]) expect(mapped({ phone: "0501234567", consent: v }).lead.consent).toBe(false);
    expect(mapped({ phone: "0501234567" }).lead.consent).toBe(false);
    expect(mapped({ phone: "0501234567", marketing_consent: "on" }).lead.consent).toBe(true);
  });

  it("cuts very long values", () => {
    const r = mapped({ phone: "0501234567", name: "א".repeat(300), source: "s".repeat(100), page: "https://x.co/" + "p".repeat(1000) });
    expect(r.lead.name).toHaveLength(120);
    expect(r.lead.source).toHaveLength(60);
    expect(r.lead.page).toHaveLength(500);
  });

  it("reads a whole request end to end", async () => {
    const body = await readLeadBody(post("full_name=%D7%93%D7%A0%D7%94+%D7%9C%D7%95%D7%99&phone_number=052-7654321&utm_campaign=x&consent=on", "application/x-www-form-urlencoded"));
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(mapped(body.data).lead).toMatchObject({ name: "דנה לוי", phone: "+972527654321", campaign: "x", consent: true });
  });
});
