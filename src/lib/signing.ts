// The digital signature for work hours: a passkey on the employee's own phone.
// Setting up stores only the phone's public key. Each shift event gets a one-time challenge made from the event itself
// (who, what, the server's time); the phone signs it after fingerprint, face or screen lock, and the signature is kept as proof.
import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { appBaseURL } from "./auth";
import { prisma } from "./db";
import { ActionError } from "./session";

const CHALLENGE_MINUTES = 3;

export type SignPurpose = "register" | "in" | "out" | "edit";

/** The site the passkeys belong to: they work only on this address. */
export function relyingParty() {
  const url = new URL(appBaseURL());
  return { rpID: url.hostname, origin: url.origin };
}

/** "iPhone", "Android" and so on, from the browser, to tell a person's phones apart in the list. */
export function deviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "מכשיר";
}

async function saveChallenge(userId: string, purpose: SignPurpose, challenge: string, data: unknown) {
  // an older challenge of the same kind is no longer needed
  await prisma.signChallenge.deleteMany({ where: { OR: [{ userId, purpose, usedAt: null }, { expiresAt: { lt: new Date(Date.now() - 86_400_000) } }] } });
  await prisma.signChallenge.create({ data: { userId, purpose, challenge, data: data as never, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000) } });
}

/** Marks the challenge used, once: a second use (a replay) is refused. */
async function takeChallenge(userId: string, purpose: SignPurpose, challenge: string) {
  const row = await prisma.signChallenge.findUnique({ where: { challenge } });
  if (!row || row.userId !== userId || row.purpose !== purpose || row.expiresAt < new Date()) throw new ActionError("עבר יותר מדי זמן. אפשר לנסות שוב.");
  const claimed = await prisma.signChallenge.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!claimed.count) throw new ActionError("החתימה הזו כבר נקלטה");
  return row;
}

function challengeOf(response: { response: { clientDataJSON: string } }): string {
  try {
    const json = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof json.challenge === "string" ? json.challenge : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- setting up a phone

export async function registrationOptions(user: { id: string; name: string; phone: string | null }) {
  const { rpID } = relyingParty();
  const existing = await prisma.signDevice.findMany({ where: { userId: user.id, revokedAt: null }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: "מיתר",
    rpID,
    userName: user.phone ?? user.id,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((d) => ({ id: d.credentialId, transports: d.transports })),
    // the phone's own lock (fingerprint, face or code) must confirm it is the person
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
    timeout: 120_000,
  });
  await saveChallenge(user.id, "register", options.challenge, null);
  return options;
}

export async function finishRegistration(userId: string, response: RegistrationResponseJSON, userAgent: string | null) {
  const { rpID, origin } = relyingParty();
  await takeChallenge(userId, "register", challengeOf(response));
  let verified;
  try {
    verified = await verifyRegistrationResponse({ response, expectedChallenge: challengeOf(response), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch {
    throw new ActionError("ההגדרה לא הצליחה. אפשר לנסות שוב.");
  }
  if (!verified.verified) throw new ActionError("ההגדרה לא הצליחה. אפשר לנסות שוב.");
  const c = verified.registrationInfo.credential;
  return prisma.signDevice.create({
    data: { userId, credentialId: c.id, publicKey: Buffer.from(c.publicKey), counter: c.counter, transports: c.transports ?? [], name: deviceName(userAgent) },
  });
}

// ---------------------------------------------------------------- signing an event

/** The challenge is a hash of the event, so the signature covers exactly this event and nothing else. */
export async function signingOptions(userId: string, purpose: Exclude<SignPurpose, "register">, event: Record<string, unknown>) {
  const devices = await prisma.signDevice.findMany({ where: { userId, revokedAt: null }, select: { credentialId: true, transports: true } });
  if (!devices.length) throw new ActionError("קודם צריך להגדיר חתימה בטלפון, במסך שעות עבודה", "setup");
  const payload = { ...event, userId, purpose, serverTime: new Date().toISOString(), nonce: randomBytes(16).toString("base64url") };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest();
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    challenge: new Uint8Array(digest),
    allowCredentials: devices.map((d) => ({ id: d.credentialId, transports: d.transports })),
    userVerification: "required",
    timeout: 120_000,
  });
  await saveChallenge(userId, purpose, options.challenge, payload);
  return options;
}

/** Checks the phone's answer. Returns what was signed, which phone signed it, and the answer itself to keep as proof. */
export async function verifySignature(userId: string, purpose: Exclude<SignPurpose, "register">, response: AuthenticationResponseJSON) {
  const { rpID, origin } = relyingParty();
  const challenge = challengeOf(response);
  const row = await takeChallenge(userId, purpose, challenge);
  const device = await prisma.signDevice.findUnique({ where: { credentialId: String(response?.id ?? "") } });
  if (!device || device.userId !== userId || device.revokedAt) throw new ActionError("הטלפון הזה לא מוגדר לחתימה שלך");
  let ok;
  try {
    ok = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: device.credentialId, publicKey: new Uint8Array(device.publicKey), counter: device.counter, transports: device.transports },
      requireUserVerification: true,
    });
  } catch {
    throw new ActionError("החתימה לא אומתה. אפשר לנסות שוב.");
  }
  if (!ok.verified) throw new ActionError("החתימה לא אומתה. אפשר לנסות שוב.");
  await prisma.signDevice.update({ where: { id: device.id }, data: { counter: ok.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  return { event: row.data as Record<string, unknown>, deviceId: device.id, response };
}
