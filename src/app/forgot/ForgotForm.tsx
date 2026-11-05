"use client";

import { useState } from "react";
import { authErrorText, authPost } from "@/lib/auth-fetch";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { passwordProblem } from "@/lib/password";

type Channel = "sms" | "whatsapp";

export function ForgotForm({ channels }: { channels: Channel[] }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [ident, setIdent] = useState("");
  const [channel, setChannel] = useState<Channel>(channels[0]);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const phone = normalizePhone(ident);

  async function request(ch: Channel) {
    setError("");
    if (!phone) return setError("מספר הטלפון לא נראה תקין. למשל 050-1234567");
    setBusy(true);
    const r = await authPost("/phone-number/request-password-reset", { phoneNumber: phone }, { "x-otp-channel": ch });
    setBusy(false);
    if (!r.ok) return setError(authErrorText(r));
    setChannel(ch);
    setStep("code");
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const c = code.replace(/\D/g, "");
    if (c.length !== 6) return setError("הקוד הוא 6 ספרות");
    const problem = passwordProblem(pw);
    if (problem) return setError(problem);
    if (pw !== pw2) return setError("שתי הסיסמאות לא זהות");
    setBusy(true);
    const r = await authPost("/phone-number/reset-password", { otp: c, phoneNumber: phone, newPassword: pw });
    setBusy(false);
    if (!r.ok) return setError(authErrorText(r));
    window.location.assign(`/login?notice=reset&phone=${encodeURIComponent(formatPhone(phone))}`);
  }

  if (step === "code")
    return (
      <>
        <h1>סיסמה חדשה</h1>
        <p className="sub">אם המספר רשום במערכת, שלחנו אליו קוד {channel === "sms" ? "ב-SMS" : "בוואטסאפ"}.</p>
        <form onSubmit={reset} noValidate>
          <label className="fld">
            <span>הקוד שקיבלת</span>
            <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <label className="fld">
            <span>סיסמה חדשה</span>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <small>לפחות 8 תווים. אפשר משפט קצר שקל לזכור.</small>
          </label>
          <label className="fld">
            <span>שוב את הסיסמה החדשה</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary full" type="submit" disabled={busy}>
            {busy ? "שומרים…" : "שמירת הסיסמה"}
          </button>
          <div className="login-foot">
            <button type="button" className="link" disabled={busy} onClick={() => request(channel)}>
              לשלוח קוד חדש
            </button>
            <a href="/login">חזרה לכניסה</a>
          </div>
        </form>
      </>
    );

  return (
    <>
      <h1>שכחתי סיסמה</h1>
      <p className="sub">נשלח קוד לנייד שרשום במערכת, ואיתו קובעים סיסמה חדשה</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          request(channels[0]);
        }}
        noValidate
      >
        <label className="fld">
          <span>מספר טלפון</span>
          <input inputMode="tel" dir="ltr" autoComplete="username" placeholder="050-1234567" value={ident} onChange={(e) => setIdent(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {channels.map((ch, i) => (
          <button key={ch} className={"btn full " + (i === 0 ? "primary" : "")} type={i === 0 ? "submit" : "button"} disabled={busy} onClick={i === 0 ? undefined : () => request(ch)}>
            {ch === "sms" ? "לשלוח קוד ב-SMS" : "לשלוח קוד בוואטסאפ"}
          </button>
        ))}
        <div className="login-foot">
          <a href="/login">חזרה לכניסה</a>
          <span>אפשר גם לבקש מהמנהל קישור חדש</span>
        </div>
      </form>
    </>
  );
}
