// Sends sign-in and password-reset codes by SMS or WhatsApp.
//
// Configure in Railway (see docs/SETUP.md):
//   SMS_PROVIDER=twilio        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID
//   WHATSAPP_PROVIDER=meta     WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_TEMPLATE
//   WHATSAPP_PROVIDER=twilio   TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_CONTENT_SID
//   ALLOW_CONSOLE_OTP=true     until a provider is connected: codes are written to the server log only

export type OtpChannel = "sms" | "whatsapp";
export type OtpPurpose = "login" | "reset";

export const CHANNEL_LABEL: Record<OtpChannel, string> = { sms: "SMS", whatsapp: "וואטסאפ" };

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface Sender {
  name: string;
  send(to: string, code: string, purpose: OtpPurpose, fetchImpl: FetchLike): Promise<void>;
}

function appHost(env: Env): string {
  const url = env.BETTER_AUTH_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "");
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

export function codeText(code: string, purpose: OtpPurpose, env: Env = process.env): string {
  const what = purpose === "reset" ? "הקוד לאיפוס הסיסמה" : "קוד הכניסה";
  const host = appHost(env);
  // The last line lets the phone offer to fill the code in by itself.
  return `${what} למערכת מיתר: ${code}\nהקוד תקף ל-5 דקות. אם לא ביקשת קוד, אפשר להתעלם מההודעה.` + (host ? `\n\n@${host} #${code}` : "");
}

function consoleOk(env: Env): boolean {
  return env.ALLOW_CONSOLE_OTP === "true" || env.NODE_ENV !== "production";
}

function twilioAuth(env: Env): string {
  return "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

async function postForm(fetchImpl: FetchLike, url: string, auth: string, form: URLSearchParams, label: string) {
  const res = await fetchImpl(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

function twilioSms(env: Env): Sender | null {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_SMS_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) return null;
  return {
    name: "twilio-sms",
    async send(to, code, purpose, fetchImpl) {
      const form = new URLSearchParams({ To: to, Body: codeText(code, purpose, env) });
      if (env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
      else form.set("From", env.TWILIO_SMS_FROM as string);
      await postForm(fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, twilioAuth(env), form, "Twilio SMS");
    },
  };
}

function twilioWhatsApp(env: Env): Sender | null {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM || !env.TWILIO_WHATSAPP_CONTENT_SID) return null;
  return {
    name: "twilio-whatsapp",
    async send(to, code, _purpose, fetchImpl) {
      const from = env.TWILIO_WHATSAPP_FROM as string;
      const form = new URLSearchParams({
        To: `whatsapp:${to}`,
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        ContentSid: env.TWILIO_WHATSAPP_CONTENT_SID as string,
        ContentVariables: JSON.stringify({ "1": code }),
      });
      await postForm(fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, twilioAuth(env), form, "Twilio WhatsApp");
    },
  };
}

function metaWhatsApp(env: Env): Sender | null {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_OTP_TEMPLATE) return null;
  return {
    name: "meta-whatsapp",
    async send(to, code, _purpose, fetchImpl) {
      const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
      // Authentication templates with a "copy code" button need the code on the button too.
      if (env.WHATSAPP_OTP_BUTTON !== "false") components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
      const version = env.WHATSAPP_GRAPH_VERSION || "v23.0";
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/\D/g, ""),
          type: "template",
          template: { name: env.WHATSAPP_OTP_TEMPLATE, language: { code: env.WHATSAPP_TEMPLATE_LANG || "he" }, components },
        }),
      });
      if (!res.ok) throw new Error(`WhatsApp Cloud API failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    },
  };
}

function consoleSender(channel: OtpChannel): Sender {
  return {
    name: "console",
    async send(to, code, purpose) {
      // Visible only in the server log. Use until SMS or WhatsApp is connected.
      console.warn(`[otp] ${purpose} code for ${to.slice(0, 6)}…${to.slice(-3)} by ${channel}: ${code}`);
    },
  };
}

export function senderFor(channel: OtpChannel, env: Env = process.env): Sender | null {
  if (channel === "sms") {
    if (env.SMS_PROVIDER === "twilio") return twilioSms(env);
  } else {
    if (env.WHATSAPP_PROVIDER === "meta") return metaWhatsApp(env);
    if (env.WHATSAPP_PROVIDER === "twilio") return twilioWhatsApp(env);
  }
  return consoleOk(env) ? consoleSender(channel) : null;
}

export function availableChannels(env: Env = process.env): OtpChannel[] {
  return (["sms", "whatsapp"] as OtpChannel[]).filter((c) => senderFor(c, env) !== null);
}

export function realProviderConnected(env: Env = process.env): boolean {
  return (["sms", "whatsapp"] as OtpChannel[]).some((c) => {
    const s = senderFor(c, env);
    return s !== null && s.name !== "console";
  });
}

/** Sends the code on the preferred channel, or on the other one if that is not connected. Returns the channel used. */
export async function sendCode(
  to: string,
  code: string,
  preferred: OtpChannel,
  purpose: OtpPurpose,
  opts: { env?: Env; fetchImpl?: FetchLike } = {},
): Promise<OtpChannel> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const order: OtpChannel[] = preferred === "whatsapp" ? ["whatsapp", "sms"] : ["sms", "whatsapp"];
  for (const channel of order) {
    const sender = senderFor(channel, env);
    if (!sender) continue;
    await sender.send(to, code, purpose, fetchImpl);
    return channel;
  }
  throw new Error("No SMS or WhatsApp provider is configured for sign-in codes");
}

export function parseChannel(v: unknown): OtpChannel | null {
  return v === "sms" || v === "whatsapp" ? v : null;
}
