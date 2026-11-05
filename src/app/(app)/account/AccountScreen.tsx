"use client";

import { useState } from "react";
import { setMyChannelAction } from "@/app/actions/account";
import { useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { authErrorText, authPost } from "@/lib/auth-fetch";
import { passwordProblem } from "@/lib/password";

export function AccountScreen({ name, roleName, phone, channel, channels, sessions }: { name: string; roleName: string; phone: string; channel: "sms" | "whatsapp"; channels: ("sms" | "whatsapp")[]; sessions: number }) {
  const toast = useToast();
  const runner = useRunner();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!cur) return setError("צריך להקליד את הסיסמה הנוכחית");
    const problem = passwordProblem(pw);
    if (problem) return setError(problem);
    if (pw !== pw2) return setError("שתי הסיסמאות החדשות לא זהות");
    setBusy(true);
    const r = await authPost("/change-password", { currentPassword: cur, newPassword: pw, revokeOtherSessions: true });
    setBusy(false);
    if (!r.ok) return setError(r.code === "INVALID_PASSWORD" ? "הסיסמה הנוכחית לא נכונה" : authErrorText(r));
    setCur("");
    setPw("");
    setPw2("");
    toast("הסיסמה הוחלפה. שאר המכשירים נותקו");
  }

  async function signOutOthers() {
    const r = await authPost("/revoke-other-sessions", {});
    toast(r.ok ? "נותקת מכל שאר המכשירים" : authErrorText(r));
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>החשבון שלי</h1>
          <p className="sub">
            {name} · {roleName} · <span className="ltr">{phone}</span>
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h2>החלפת סיסמה</h2>
          <form onSubmit={change} noValidate className="stack">
            <label className="fld">
              <span>הסיסמה הנוכחית</span>
              <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
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
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "שומרים…" : "החלפת הסיסמה"}
            </button>
          </form>
        </div>
        <div className="panel">
          <h2>קוד הכניסה</h2>
          <p className="muted">בכל כניסה ממכשיר חדש נשלח קוד לנייד שלך. לאן לשלוח אותו קודם?</p>
          <div className="chips" style={{ margin: "12px 0" }}>
            {channels.map((c) => (
              <button key={c} type="button" className={c === channel ? "on" : ""} aria-pressed={c === channel} onClick={() => runner(setMyChannelAction(c))}>
                {c === "sms" ? "SMS" : "וואטסאפ"}
              </button>
            ))}
          </div>
          <h2 style={{ marginTop: 18 }}>מכשירים מחוברים</h2>
          <p className="muted">{sessions === 1 ? "החשבון מחובר במכשיר אחד, זה שלך." : `החשבון מחובר ב-${sessions} מכשירים.`}</p>
          {sessions > 1 && (
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={signOutOthers}>
              לנתק את כל שאר המכשירים
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
