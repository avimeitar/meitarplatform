// Facebook and Instagram Lead Ads: the checks on what Meta sends, and what is asked of Meta.
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { leadFields, leadgenChanges, loginUrl, META_PERMISSIONS, metaConfig, metaVerifyToken, openToken, sealToken, signatureOk } from "@/lib/meta";
import { mapLeadFields } from "@/lib/intake";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-meta-0123456789";
  process.env.BETTER_AUTH_URL = "https://crm.example.co.il";
  process.env.META_APP_ID = "1234";
  process.env.META_APP_SECRET = "app-secret";
  delete process.env.META_LOGIN_CONFIG_ID;
});

describe("the webhook", () => {
  it("accepts only deliveries signed with the app secret", () => {
    const raw = JSON.stringify({ object: "page", entry: [] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(raw).digest("hex");
    expect(signatureOk(raw, sig, "app-secret")).toBe(true);
    expect(signatureOk(raw + " ", sig, "app-secret")).toBe(false);
    expect(signatureOk(raw, sig, "other-secret")).toBe(false);
    expect(signatureOk(raw, null, "app-secret")).toBe(false);
    expect(signatureOk(raw, "sha1=abc", "app-secret")).toBe(false);
  });

  it("finds the new leads in a delivery, and nothing else", () => {
    const changes = leadgenChanges({
      object: "page",
      entry: [
        { id: "111", changes: [{ field: "leadgen", value: { leadgen_id: "999", page_id: "111", form_id: "555", created_time: 1700000000 } }, { field: "feed", value: { post_id: "1" } }] },
        { id: "222", changes: [{ field: "leadgen", value: { leadgen_id: "not-a-number", page_id: "222" } }] },
      ],
    });
    expect(changes).toEqual([{ leadgenId: "999", pageId: "111", formId: "555", createdTime: 1700000000 }]);
    expect(leadgenChanges({ object: "user", entry: [] })).toEqual([]);
    expect(leadgenChanges("junk")).toEqual([]);
  });

  it("the verify word is fixed for a system, and different between systems", () => {
    const a = metaVerifyToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(metaVerifyToken()).toBe(a);
    process.env.BETTER_AUTH_SECRET = "another-secret-0123456789abcdef";
    expect(metaVerifyToken()).not.toBe(a);
    process.env.BETTER_AUTH_SECRET = "test-secret-for-meta-0123456789";
  });
});

describe("page tokens", () => {
  it("are kept encrypted, and come back as they were", () => {
    const sealed = sealToken("EAAB-page-token");
    expect(sealed).not.toContain("EAAB");
    expect(openToken(sealed)).toBe("EAAB-page-token");
    expect(sealToken("EAAB-page-token")).not.toBe(sealed);
    const [v, iv, tag, data] = sealed.split(".");
    expect(() => openToken([v, iv, tag, data.slice(0, -2) + "AA"].join("."))).toThrow();
  });
});

describe("signing in and the lead's answers", () => {
  it("asks for the permissions by name, or by a Login for Business configuration", () => {
    const cfg = metaConfig()!;
    const url = new URL(loginUrl(cfg, "st"));
    expect(url.searchParams.get("client_id")).toBe("1234");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.example.co.il/api/meta/callback");
    expect(url.searchParams.get("scope")).toBe(META_PERMISSIONS.join(","));
    process.env.META_LOGIN_CONFIG_ID = "777";
    const withConfig = new URL(loginUrl(metaConfig()!, "st"));
    expect(withConfig.searchParams.get("config_id")).toBe("777");
    expect(withConfig.searchParams.get("scope")).toBeNull();
    delete process.env.META_LOGIN_CONFIG_ID;
  });

  it("Facebook's form fields become a lead", () => {
    const f = leadFields({ field_data: [{ name: "full_name", values: ["דנה כהן"] }, { name: "phone_number", values: ["+972501234567"] }, { name: "email", values: ["dana@example.com"] }, { name: "באיזה_חדר?", values: ["4", "5"] }] });
    expect(f["באיזה_חדר?"]).toBe("4, 5");
    const m = mapLeadFields(f);
    expect(m.ok && m.lead.name).toBe("דנה כהן");
    expect(m.ok && m.lead.phone).toBe("+972501234567");
    expect(m.ok && m.lead.email).toBe("dana@example.com");
  });
});
