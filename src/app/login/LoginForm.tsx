"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { authErrorText, authPost, type AuthResult } from "@/lib/auth-fetch";
import { normalizePhone } from "@/lib/phone";

type Channel = "sms" | "whatsapp";
const STORE = "meitar.otpChannel";
const VIA: Record<Channel, string> = { sms: "ב-SMS", whatsapp: "בוואטסאפ" };

/** Where to go after signing in: only a page of this site ("/\\evil.example" and similar tricks go home instead). */
function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

export function LoginForm({ codeOn, channels, initialPhone, notice, next }: { codeOn: boolean; channels: Channel[]; initialPhone: string; notice: string; next: string }) {
  const [step, setStep] = useState<"password" | "channel" | "code">("password");
  const [ident, setIdent] = useState(initialPhone);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [channel, setChannel] = useState<Channel>(channels[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const phone = normalizePhone(ident);
  const tail = phone ? phone.slice(-3) : null;

  function savedChannel(): Channel | null {
    try {
      const v = localStorage.getItem(STORE);
      return (v === "sms" || v === "whatsapp") && channels.includes(v) ? v : null;
    } catch {
      return null;
    }
  }

  function restart(r: AuthResult<unknown>) {
    if (r.code === "INVALID_TWO_FACTOR_COOKIE") {
      setStep("password");
      setPassword("");
    }
  }

  async function sendCode(ch: Channel) {
    setBusy(true);
    setError("");
    const r = await authPost("/two-factor/send-otp", {}, { "x-otp-channel": ch });
    setBusy(false);
    if (!r.ok) {
      restart(r);
      setError(authErrorText(r));
      return;
    }
    try {
      localStorage.setItem(STORE, ch);
    } catch {
      // private mode: the choice is just not remembered
    }
    setChannel(ch);
    setStep("code");
    setCode("");
    setCooldown(30);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const id = ident.trim();
    if (!id) return setError("צריך להקליד את מספר הטלפון");
    if (!password) return setError("צריך להקליד את הסיסמה");
    setBusy(true);
    let r: AuthResult<{ twoFactorRedirect?: boolean }>;
    if (id.includes("@")) {
      r = await authPost("/sign-in/email", { email: id.toLowerCase(), password, rememberMe: true });
    } else {
      if (!phone) {
        setBusy(false);
        return setError("מספר הטלפון לא נראה תקין. למשל 050-1234567");
      }
      r = await authPost("/sign-in/phone-number", { phoneNumber: phone, password, rememberMe: true });
    }
    setBusy(false);
    if (!r.ok) return setError(authErrorText(r));
    if (r.data?.twoFactorRedirect) {
      const pre = savedChannel() ?? (channels.length === 1 ? channels[0] : null);
      if (pre) await sendCode(pre);
      else setStep("channel");
      return;
    }
    go();
  }

  async function submitCode(value?: string) {
    const c = (value ?? code).replace(/\D/g, "");
    if (c.length !== 6) return setError("הקוד הוא 6 ספרות");
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const r = await authPost("/two-factor/verify-otp", { code: c, trustDevice: trust });
    sending.current = false;
    if (!r.ok) {
      setBusy(false);
      restart(r);
      setError(authErrorText(r));
      setCode("");
      // the field is disabled while checking: focus it once it is enabled again, so the keyboard stays open
      setTimeout(() => codeRef.current?.focus(), 50);
      return;
    }
    go();
  }

  function go() {
    window.location.assign(safeNext(next));
  }

  const toPhone = tail ? (
    <>
      לנייד שמסתיים ב-<span className="ltr">{tail}</span>
    </>
  ) : (
    "לנייד שלך"
  );

  if (step === "channel")
    return (
      <>
        <h1>לאן לשלוח את הקוד?</h1>
        <p className="sub">נשלח קוד כניסה בן 6 ספרות {toPhone}</p>
        <div className="opts">
          {channels.map((ch) => (
            <button key={ch} type="button" className="opt good" disabled={busy} onClick={() => sendCode(ch)}>
              <span className="oi">
                <Icon name={ch === "whatsapp" ? "wa" : "mobile"} />
              </span>
              <span>
                <b>{ch === "sms" ? "בהודעת SMS" : "בוואטסאפ"}</b>
                <small>{ch === "sms" ? "הודעה רגילה לטלפון" : "הודעה מהחשבון העסקי של מיתר"}</small>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="login-foot">
          <button type="button" className="link" onClick={() => (setStep("password"), setError(""))}>
            חזרה
          </button>
        </div>
      </>
    );

  if (step === "code")
    return (
      <>
        <h1>מקלידים את הקוד</h1>
        <p className="sub">
          שלחנו קוד {VIA[channel]} {toPhone}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCode();
          }}
          noValidate
        >
          <label className="fld">
            <span>קוד בן 6 ספרות</span>
            <input
              ref={codeRef}
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              dir="ltr"
              value={code}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) submitCode(v);
              }}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            לזכור את המכשיר הזה ל-30 יום
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary full" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "בודקים…" : "כניסה"}
          </button>
          <div className="login-foot">
            <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={() => sendCode(channel)}>
              {cooldown > 0 ? `קוד חדש בעוד ${cooldown} שניות` : "לשלוח קוד חדש"}
            </button>
            {channels.length > 1 && (
              <button type="button" className="link" disabled={busy} onClick={() => sendCode(channel === "sms" ? "whatsapp" : "sms")}>
                {channel === "sms" ? "לשלוח בוואטסאפ במקום" : "לשלוח ב-SMS במקום"}
              </button>
            )}
          </div>
        </form>
      </>
    );

  return (
    <>
      <h1>כניסה למערכת</h1>
      <p className="sub">{codeOn ? "נכנסים עם מספר הטלפון והסיסמה, ואז עם קוד שנשלח לנייד" : "נכנסים עם מספר הטלפון והסיסמה"}</p>
      {notice && (
        <p className="login-ok" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={submitPassword} noValidate>
        <label className="fld">
          <span>מספר טלפון</span>
          <input name="username" inputMode="tel" dir="ltr" autoComplete="username" placeholder="050-1234567" value={ident} onChange={(e) => setIdent(e.target.value)} />
        </label>
        <label className="fld">
          <span>סיסמה</span>
          <input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary full" type="submit" disabled={busy}>
          {busy ? "בודקים…" : "המשך"}
        </button>
        <div className="login-foot">
          <a href="/forgot">שכחתי סיסמה</a>
          <span className="secure">
            <Icon name="lock" />
            חיבור מאובטח
          </span>
        </div>
      </form>
    </>
  );
}
