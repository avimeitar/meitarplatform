// Small client helper for the sign-in screens: calls Better Auth's endpoints and turns errors into Hebrew.
export type AuthResult<T = Record<string, unknown>> = { ok: boolean; status: number; data: T | null; code?: string; message?: string };

export async function authPost<T = Record<string, unknown>>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<AuthResult<T>> {
  try {
    const res = await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const d = (data ?? {}) as { code?: string; message?: string };
    return { ok: res.ok, status: res.status, data: data as T, code: res.ok ? undefined : d.code, message: res.ok ? undefined : d.message };
  } catch {
    return { ok: false, status: 0, data: null, code: "NETWORK" };
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_PHONE_NUMBER_OR_PASSWORD: "הטלפון או הסיסמה לא נכונים",
  INVALID_EMAIL_OR_PASSWORD: "האימייל או הסיסמה לא נכונים",
  INVALID_PASSWORD: "הסיסמה לא נכונה",
  INVALID_CODE: "הקוד לא נכון. אפשר לבדוק ולהקליד שוב.",
  INVALID_OTP: "הקוד לא נכון. אפשר לבדוק ולהקליד שוב.",
  OTP_HAS_EXPIRED: "תוקף הקוד עבר. צריך לבקש קוד חדש.",
  OTP_EXPIRED: "תוקף הקוד עבר. צריך לבקש קוד חדש.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "היו יותר מדי ניסיונות עם הקוד הזה. צריך לבקש קוד חדש.",
  TOO_MANY_ATTEMPTS: "היו יותר מדי ניסיונות. צריך לבקש קוד חדש.",
  INVALID_TWO_FACTOR_COOKIE: "עבר יותר מדי זמן. צריך להתחיל את הכניסה מחדש.",
  PASSWORD_TOO_SHORT: "הסיסמה קצרה מדי. צריך לפחות 8 תווים.",
  PASSWORD_TOO_LONG: "הסיסמה ארוכה מדי",
  NETWORK: "אין חיבור לאינטרנט. אפשר לבדוק את החיבור ולנסות שוב.",
};

export function authErrorText(r: AuthResult<unknown>): string {
  if (r.status === 429 && r.code !== "OTP_HOURLY_LIMIT") return "היו יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.";
  if (r.code === "ACCOUNT_INACTIVE" || r.code === "OTP_HOURLY_LIMIT") return r.message || "אי אפשר להמשיך כרגע.";
  if (r.code && MESSAGES[r.code]) return MESSAGES[r.code];
  if (r.status === 503) return "המערכת עוד לא הוגדרה. צריך לחבר מסד נתונים ומפתח אבטחה.";
  return "משהו השתבש. אפשר לנסות שוב.";
}
