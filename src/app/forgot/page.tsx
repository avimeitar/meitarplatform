import { SetupNotice } from "@/components/SetupNotice";
import { authConfigured } from "@/lib/auth";
import { availableChannels } from "@/lib/otp";
import { ForgotForm } from "./ForgotForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "שכחתי סיסמה" };

export default function ForgotPage() {
  const cfg = authConfigured();
  if (!cfg.ok) return <SetupNotice missing={cfg.missing} />;
  const channels = availableChannels();
  if (channels.length === 0)
    return (
      <main className="login">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
          <h1>שכחתי סיסמה</h1>
          <p className="sub">מנהל המערכת יכול לשלוח לך קישור לקביעת סיסמה חדשה, ממסך המשתמשים.</p>
          <a className="btn primary full" href="/login">
            חזרה לכניסה
          </a>
        </div>
      </main>
    );
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        <ForgotForm channels={channels} />
      </div>
    </main>
  );
}
