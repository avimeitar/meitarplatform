import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { authConfigured } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { availableChannels } from "@/lib/otp";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "כניסה" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const cfg = authConfigured();
  if (!cfg.ok) return <SetupNotice missing={cfg.missing} />;
  const channels = availableChannels();
  if (channels.length === 0) return <SetupNotice missing={["OTP"]} />;
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const noUsers = (await prisma.user.count({ where: { deletedAt: null } })) === 0;
  return (
    <main className="login">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-blue.webp" alt="מיתר נדל״ן והשקעות" />
        <LoginForm channels={channels} initialPhone={sp.phone ?? ""} notice={sp.notice === "password-set" ? "הסיסמה נשמרה. עכשיו נכנסים עם הטלפון והסיסמה." : sp.notice === "reset" ? "הסיסמה החדשה נשמרה. אפשר להיכנס." : ""} next={sp.next ?? ""} />
        {noUsers && <p className="login-hint">עוד אין משתמשים במערכת. מנהל המערכת הראשון נוצר מהגדרות Railway, לפי docs/SETUP.md.</p>}
      </div>
    </main>
  );
}
