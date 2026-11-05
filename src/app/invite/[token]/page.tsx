import { SetupNotice } from "@/components/SetupNotice";
import { authConfigured } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { findValidInvite } from "@/lib/users";
import { InviteForm } from "./InviteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "קביעת סיסמה" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const cfg = authConfigured();
  if (!cfg.ok) return <SetupNotice missing={cfg.missing} />;
  const { token } = await params;
  const inv = await findValidInvite(token);
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        {inv ? (
          <InviteForm token={token} name={inv.user.name} phone={formatPhone(inv.user.phoneNumber)} purpose={inv.purpose === "reset" ? "reset" : "invite"} />
        ) : (
          <>
            <h1>הקישור לא בתוקף</h1>
            <p className="sub">יכול להיות שכבר השתמשו בו, או שעבר הזמן שלו. אפשר לבקש מהמנהל קישור חדש, או לאפס סיסמה עם קוד לנייד.</p>
            <a className="btn primary full" href="/forgot">
              לאיפוס סיסמה
            </a>
          </>
        )}
      </div>
    </main>
  );
}
