import { describe, expect, it, vi } from "vitest";
import { availableChannels, codeText, realProviderConnected, sendCode, senderFor } from "@/lib/otp";

const twilio = { NODE_ENV: "production", SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_SMS_FROM: "Meitar" };
const meta = { NODE_ENV: "production", WHATSAPP_PROVIDER: "meta", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_OTP_TEMPLATE: "login_code" };

describe("sign-in codes", () => {
  it("in production nothing is available until a provider is connected", () => {
    expect(availableChannels({ NODE_ENV: "production" })).toEqual([]);
    expect(availableChannels({ NODE_ENV: "production", ALLOW_CONSOLE_OTP: "true" })).toEqual(["sms", "whatsapp"]);
    expect(realProviderConnected({ NODE_ENV: "production", ALLOW_CONSOLE_OTP: "true" })).toBe(false);
  });
  it("Twilio SMS posts the code with the phone's auto-fill line", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201, text: async () => "" }));
    const env = { ...twilio, BETTER_AUTH_URL: "https://crm.meitargroup.co.il" };
    const used = await sendCode("+972501234567", "123456", "sms", "login", { env, fetchImpl });
    expect(used).toBe("sms");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toContain("/Accounts/AC1/Messages.json");
    const body = new URLSearchParams(init.body);
    expect(body.get("To")).toBe("+972501234567");
    expect(body.get("From")).toBe("Meitar");
    expect(body.get("Body")).toContain("123456");
    expect(body.get("Body")).toContain("@crm.meitargroup.co.il #123456");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("AC1:tok").toString("base64"));
  });
  it("WhatsApp Cloud API uses the authentication template with the code on the button", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    await sendCode("+972501234567", "654321", "whatsapp", "login", { env: meta, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("/123/messages");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("972501234567");
    expect(body.template.name).toBe("login_code");
    expect(body.template.components[1]).toMatchObject({ type: "button", sub_type: "url" });
  });
  it("falls back to the other channel when the preferred one is not connected", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201, text: async () => "" }));
    expect(await sendCode("+972501234567", "111111", "whatsapp", "login", { env: twilio, fetchImpl })).toBe("sms");
  });
  it("provider errors are reported, not swallowed", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => "bad number" }));
    await expect(sendCode("+972501234567", "111111", "sms", "login", { env: twilio, fetchImpl })).rejects.toThrow(/400/);
  });
  it("a provider without its keys is not used", () => {
    expect(senderFor("sms", { NODE_ENV: "production", SMS_PROVIDER: "twilio" })).toBeNull();
  });
  it("reset codes say what they are for", () => {
    expect(codeText("123456", "reset", {})).toContain("לאיפוס הסיסמה");
  });
});
