import { prisma } from "./db";

export type AuditInput = {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
};

export async function audit(e: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: e.actorId ?? null,
        actorName: e.actorName ?? null,
        action: e.action,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        targetName: e.targetName ?? null,
        meta: (e.meta ?? undefined) as never,
        ip: e.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] could not write", e.action, err);
  }
}

export const AUDIT_LABELS: Record<string, string> = {
  "auth.login": "כניסה למערכת",
  "auth.login_trusted": "כניסה ממכשיר מוכר",
  "auth.login_failed": "ניסיון כניסה שנכשל",
  "auth.blocked_inactive": "ניסיון כניסה של חשבון לא פעיל",
  "auth.otp_sent": "נשלח קוד כניסה",
  "auth.otp_failed": "הוקלד קוד שגוי",
  "auth.otp_limit": "נחסמה שליחת קוד (יותר מדי בקשות)",
  "auth.otp_error": "שליחת הקוד נכשלה",
  "auth.reset_requested": "בקשה לאיפוס סיסמה",
  "auth.reset_done": "איפוס סיסמה",
  "auth.password_set": "קביעת סיסמה מקישור",
  "auth.password_changed": "החלפת סיסמה",
  "auth.logout": "יציאה מהמערכת",
  "user.create": "הוספת משתמש",
  "user.update": "עדכון פרטי משתמש",
  "user.role": "שינוי תפקיד",
  "user.deactivate": "השבתת משתמש",
  "user.activate": "החזרת משתמש לפעילות",
  "user.delete": "מחיקת משתמש",
  "user.invite": "שליחת קישור כניסה",
  "user.sessions_revoked": "ניתוק מכל המכשירים",
  "role.create": "יצירת תפקיד",
  "role.update": "שינוי הרשאות של תפקיד",
  "role.delete": "מחיקת תפקיד",
  "lead.delete": "מחיקת ליד",
  "lead.export": "ייצוא לידים",
  "lead.import": "ייבוא לידים מקובץ",
  "meeting.import": "ייבוא פגישות מקובץ",
  "lead.bulk_assign": "העברת כמה לידים",
  "apikey.create": "יצירת מפתח לקליטת לידים",
  "apikey.revoke": "ביטול מפתח לקליטת לידים",
  "project.create": "הוספת פרויקט",
  "project.update": "עדכון פרויקט",
  "settings.require_code": "שינוי חובת קוד בכניסה",
  "settings.lock": "נעילה או פתיחה של הכניסה למשתמשים",
  "auth.blocked_locked": "ניסיון כניסה כשהכניסה נעולה",
};

export function maskPhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.length > 6 ? `${p.slice(0, 5)}…${p.slice(-3)}` : p;
}
