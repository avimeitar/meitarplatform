import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber, twoFactor } from "better-auth/plugins";
import { audit, maskPhone } from "./audit";
import { prisma } from "./db";
import { parseChannel, sendCode, type OtpChannel } from "./otp";
import { passwordProblem } from "./password";
import { isSystemAdminRole, signInLocked } from "./settings";

const OTP_PER_HOUR = 8;
const SIGN_IN_PATHS = new Set(["/sign-in/phone-number", "/sign-in/email"]);
/** Wrong passwords allowed for one account in 15 minutes, from any address. */
const FAILED_PER_ACCOUNT = 10;
/** The auth route copies the client's address into this header, so rate limits count per real address. */
export const CLIENT_IP_HEADER = "x-meitar-client-ip";

export function appBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "http://localhost:3000";
}

type HeadersLike = { get(name: string): string | null } | undefined;

function clientIp(h: HeadersLike): string | null {
  // the last address is the one added by Railway's proxy; earlier ones can be typed by anyone
  const fwd = h?.get("x-forwarded-for");
  const list = fwd ? fwd.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return list[list.length - 1] || h?.get("x-real-ip") || null;
}

export { clientIp };

async function otpSentLastHour(userId: string): Promise<number> {
  return prisma.auditLog.count({ where: { actorId: userId, action: "auth.otp_sent", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
}

/** The account a sign-in or reset request is about, from its phone number or email. */
async function accountFor(body: Record<string, unknown>) {
  const select = { id: true, name: true, active: true, deletedAt: true, role: true } as const;
  if (typeof body.phoneNumber === "string" && body.phoneNumber) return prisma.user.findUnique({ where: { phoneNumber: body.phoneNumber }, select });
  if (typeof body.email === "string" && body.email) return prisma.user.findUnique({ where: { email: body.email.toLowerCase() }, select });
  return null;
}

/** Wrong passwords for this account in the last 15 minutes, not counting the ones before its password last changed. */
async function failedSignIns(userId: string): Promise<number> {
  const acc = await prisma.account.findFirst({ where: { userId, providerId: "credential" }, select: { updatedAt: true } });
  const since = Math.max(Date.now() - 15 * 60_000, acc?.updatedAt.getTime() ?? 0);
  return prisma.auditLog.count({ where: { action: "auth.login_failed", targetType: "user", targetId: userId, createdAt: { gte: new Date(since) } } });
}

/** After a password reset or change: open set-password links stop working. */
async function voidOpenLinks(userId: string) {
  await prisma.invite.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
}

async function deliverCode(userId: string, code: string, requested: OtpChannel | null, purpose: "login" | "reset", ip: string | null) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, phoneNumber: true, otpChannel: true } });
  if (!u?.phoneNumber) {
    await audit({ actorId: userId, action: "auth.otp_error", meta: { reason: "no phone" }, ip });
    return;
  }
  const preferred = requested ?? parseChannel(u.otpChannel) ?? "sms";
  try {
    const used = await sendCode(u.phoneNumber, code, preferred, purpose);
    await audit({ actorId: u.id, actorName: u.name, action: "auth.otp_sent", meta: { channel: used, purpose }, ip });
    // the preferred channel is remembered only during sign-in, after the password was right (a reset request is anonymous)
    if (purpose === "login" && requested && requested !== u.otpChannel) await prisma.user.update({ where: { id: u.id }, data: { otpChannel: requested } });
  } catch (err) {
    await audit({ actorId: u.id, actorName: u.name, action: "auth.otp_error", meta: { channel: preferred, purpose, error: String(err).slice(0, 200) }, ip });
    throw err;
  }
}

// Writes sign-in events to the audit log. It runs after the two-factor plugin, so it sees the final result.
const auditTrail = {
  id: "meitar-audit",
  hooks: {
    before: [
      {
        matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? ""),
        // Checked before the password: a locked, deactivated or throttled account can't be used to test passwords.
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const u = await accountFor(body);
          if (!u) return;
          const ip = clientIp(ctx.headers);
          const byPhone = ctx.path === "/sign-in/phone-number";
          if (!u.active || u.deletedAt) {
            await audit({ action: "auth.blocked_inactive", targetType: "user", targetId: u.id, targetName: u.name, ip });
            // the same answer as a wrong password
            throw new APIError("UNAUTHORIZED", { message: "Invalid credentials", code: byPhone ? "INVALID_PHONE_NUMBER_OR_PASSWORD" : "INVALID_EMAIL_OR_PASSWORD" });
          }
          if ((await signInLocked()) && !isSystemAdminRole(u.role)) {
            await audit({ action: "auth.blocked_locked", targetType: "user", targetId: u.id, targetName: u.name, ip });
            throw new APIError("FORBIDDEN", { message: "הכניסה למערכת סגורה כרגע. אפשר לפנות למנהל המערכת.", code: "SIGN_IN_LOCKED" });
          }
          if ((await failedSignIns(u.id)) >= FAILED_PER_ACCOUNT) {
            await audit({ action: "auth.login_throttled", targetType: "user", targetId: u.id, targetName: u.name, ip });
            throw new APIError("TOO_MANY_REQUESTS", { message: "היו יותר מדי ניסיונות כניסה לחשבון הזה. אפשר לנסות שוב בעוד רבע שעה, או לבחור ״שכחתי סיסמה״.", code: "ACCOUNT_THROTTLED" });
          }
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/phone-number/reset-password" || ctx.path === "/change-password",
        // The same password rules as on the screens, also for direct calls.
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const problem = passwordProblem(typeof body.newPassword === "string" ? body.newPassword : "");
          if (problem) throw new APIError("BAD_REQUEST", { message: problem, code: "WEAK_PASSWORD" });
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/phone-number/request-password-reset",
        // Past the hourly cap no new code is made, so the code the person already got keeps working.
        handler: createAuthMiddleware(async (ctx) => {
          const u = await accountFor((ctx.body ?? {}) as Record<string, unknown>);
          if (!u || !u.active || u.deletedAt) return;
          if ((await otpSentLastHour(u.id)) >= OTP_PER_HOUR) {
            await audit({ actorId: u.id, action: "auth.otp_limit", ip: clientIp(ctx.headers) });
            throw new APIError("TOO_MANY_REQUESTS", { message: "נשלחו יותר מדי קודים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.", code: "OTP_HOURLY_LIMIT" });
          }
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/two-factor/send-otp",
        // Codes are sent only in the middle of a sign-in, and at most OTP_PER_HOUR an hour per account (SMS costs money and invites abuse).
        handler: createAuthMiddleware(async (ctx) => {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const pending = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (!pending) throw new APIError("UNAUTHORIZED", { message: "צריך להתחיל את הכניסה מחדש", code: "INVALID_TWO_FACTOR_COOKIE" });
          const v = await ctx.context.internalAdapter.findVerificationValue(pending);
          if (!v?.value) throw new APIError("UNAUTHORIZED", { message: "צריך להתחיל את הכניסה מחדש", code: "INVALID_TWO_FACTOR_COOKIE" });
          if ((await otpSentLastHour(v.value)) >= OTP_PER_HOUR) {
            await audit({ actorId: v.value, action: "auth.otp_limit", ip: clientIp(ctx.headers) });
            throw new APIError("TOO_MANY_REQUESTS", { message: "נשלחו יותר מדי קודים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.", code: "OTP_HOURLY_LIMIT" });
          }
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? "") || ["/two-factor/verify-otp", "/phone-number/reset-password", "/phone-number/request-password-reset", "/change-password"].includes(ctx.path ?? ""),
        handler: createAuthMiddleware(async (ctx) => {
          const returned = ctx.context.returned;
          const ip = clientIp(ctx.headers);
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const who = typeof body.phoneNumber === "string" ? maskPhone(body.phoneNumber) : typeof body.email === "string" ? body.email : "";
          if (SIGN_IN_PATHS.has(ctx.path ?? "")) {
            if (isAPIError(returned)) {
              const code = (returned.body as { code?: string } | undefined)?.code;
              // tied to the account, so wrong passwords can be counted per account
              const u = code === "ACCOUNT_INACTIVE" || code === "SIGN_IN_LOCKED" ? null : await accountFor(body);
              await audit({
                action: code === "ACCOUNT_INACTIVE" ? "auth.blocked_inactive" : code === "SIGN_IN_LOCKED" ? "auth.blocked_locked" : "auth.login_failed",
                targetType: u ? "user" : null,
                targetId: u?.id ?? null,
                targetName: u?.name ?? who,
                meta: { code },
                ip,
              });
              return;
            }
            const s = ctx.context.newSession;
            if (s) {
              // the two-factor step was skipped because this device is trusted
              await prisma.user.update({ where: { id: s.user.id }, data: { lastLoginAt: new Date() } });
              await audit({ actorId: s.user.id, actorName: s.user.name, action: "auth.login_trusted", ip });
            }
            return;
          }
          if (ctx.path === "/two-factor/verify-otp") {
            if (isAPIError(returned)) {
              await audit({ action: "auth.otp_failed", meta: { code: (returned.body as { code?: string } | undefined)?.code }, ip });
              return;
            }
            const s = ctx.context.newSession;
            if (s) {
              await prisma.user.update({ where: { id: s.user.id }, data: { lastLoginAt: new Date(), phoneNumberVerified: true } });
              await audit({ actorId: s.user.id, actorName: s.user.name, action: "auth.login", ip });
            }
            return;
          }
          if (ctx.path === "/phone-number/request-password-reset" && !isAPIError(returned)) await audit({ action: "auth.reset_requested", targetName: who, ip });
          if (ctx.path === "/phone-number/reset-password" && !isAPIError(returned)) {
            const u = await accountFor(body);
            if (u) {
              // a new password signs out every device and voids links that are still open
              await prisma.session.deleteMany({ where: { userId: u.id } });
              await prisma.verification.deleteMany({ where: { value: u.id, identifier: { startsWith: "trust-device-" } } });
              await voidOpenLinks(u.id);
            }
            await audit({ actorId: u?.id ?? null, actorName: u?.name ?? null, action: "auth.reset_done", targetName: who, ip });
          }
          if (ctx.path === "/change-password" && !isAPIError(returned)) {
            const s = ctx.context.session;
            if (s) await voidOpenLinks(s.user.id);
            await audit({ actorId: s?.user.id ?? null, actorName: s?.user.name ?? null, action: "auth.password_changed", ip });
          }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

function createAuth() {
  const base = appBaseURL();
  return betterAuth({
    appName: "מיתר",
    baseURL: base,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [base],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: false, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: { cookiePrefix: "meitar", ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    rateLimit: {
      enabled: process.env.NODE_ENV === "production" || process.env.RATE_LIMIT === "on",
      storage: "database",
      window: 60,
      max: 120,
      // Per internet address. A whole office shares one address and signs in at the same time, so these are generous;
      // guessing one account's password is limited per account (FAILED_PER_ACCOUNT), and codes per account (OTP_PER_HOUR).
      customRules: {
        "/sign-in/phone-number": { window: 60, max: 30 },
        "/sign-in/email": { window: 60, max: 10 },
        "/two-factor/send-otp": { window: 300, max: 30 },
        "/two-factor/verify-otp": { window: 60, max: 30 },
        "/phone-number/request-password-reset": { window: 900, max: 10 },
        "/phone-number/reset-password": { window: 900, max: 20 },
      },
    },
    // Public sign-up, passwordless phone sign-in, self-service 2FA changes and self-edits are all off.
    disabledPaths: [
      "/sign-up/email",
      "/phone-number/send-otp",
      "/phone-number/verify",
      "/phone-number/update",
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/get-totp-uri",
      "/two-factor/verify-totp",
      "/two-factor/generate-backup-codes",
      "/two-factor/verify-backup-code",
      "/update-user",
      "/change-email",
      "/delete-user",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
    ],
    databaseHooks: {
      session: {
        create: {
          // Deactivated and deleted accounts cannot sign in, not even with a trusted device.
          before: async (session) => {
            const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { active: true, deletedAt: true, role: true } });
            if (!u || !u.active || u.deletedAt) {
              throw new APIError("FORBIDDEN", { message: "החשבון הזה לא פעיל. אפשר לפנות למנהל המערכת.", code: "ACCOUNT_INACTIVE" });
            }
            if ((await signInLocked()) && !isSystemAdminRole(u.role)) {
              throw new APIError("FORBIDDEN", { message: "הכניסה למערכת סגורה כרגע. אפשר לפנות למנהל המערכת.", code: "SIGN_IN_LOCKED" });
            }
            return { data: session };
          },
        },
      },
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        requireVerification: false,
        // Passwordless phone sign-in is disabled above; codes are only used for password resets.
        sendOTP: async () => {},
        sendPasswordResetOTP: async ({ phoneNumber: phone, code }, ctx) => {
          const u = await prisma.user.findUnique({ where: { phoneNumber: phone }, select: { id: true, active: true, deletedAt: true } });
          if (!u || !u.active || u.deletedAt) return;
          if ((await otpSentLastHour(u.id)) >= OTP_PER_HOUR) return;
          await deliverCode(u.id, code, parseChannel(ctx?.headers?.get("x-otp-channel")), "reset", clientIp(ctx?.headers));
        },
      }),
      twoFactor({
        issuer: "Meitar",
        totpOptions: { disable: true },
        twoFactorCookieMaxAge: 600,
        trustDeviceMaxAge: 60 * 60 * 24 * 30,
        otpOptions: {
          period: 5,
          digits: 6,
          storeOTP: "hashed",
          allowedAttempts: 5,
          sendOTP: async ({ user, otp }, ctx) => {
            await deliverCode(user.id, otp, parseChannel(ctx?.headers?.get("x-otp-channel")), "login", clientIp(ctx?.headers));
          },
        },
      }),
      auditTrail,
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __auth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__auth) globalForAuth.__auth = createAuth();
  return globalForAuth.__auth;
}

export function authConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  return { ok: missing.length === 0, missing };
}
