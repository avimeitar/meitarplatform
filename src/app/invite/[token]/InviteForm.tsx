"use client";

import { useState } from "react";
import { passwordProblem } from "@/lib/password";
import { acceptInvite } from "./actions";

export function InviteForm({ token, name, phone, purpose }: { token: string; name: string; phone: string; purpose: "invite" | "reset" }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = name.split(/\s+/)[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = passwordProblem(pw);
    if (problem) return setError(problem);
    if (pw !== pw2) return setError("שתי הסיסמאות לא זהות");
    setBusy(true);
    const r = await acceptInvite(token, pw);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    window.location.assign(`/login?notice=password-set&phone=${encodeURIComponent(r.data?.phone ?? phone)}`);
  }

  return (
    <>
      <h1>{purpose === "invite" ? `שלום ${first}, ברוכים הבאים` : `שלום ${first}`}</h1>
      <p className="sub">{purpose === "invite" ? "כדי להתחיל, קובעים סיסמה. אחר כך נכנסים עם הטלפון והסיסמה." : "קובעים סיסמה חדשה, ואחר כך נכנסים."}</p>
      <form onSubmit={submit} noValidate>
        <div className="fld">
          <span>מספר הטלפון שלך במערכת</span>
          <b className="ltr">{phone}</b>
        </div>
        <label className="fld">
          <span>סיסמה</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <small>לפחות 8 תווים. אפשר משפט קצר שקל לזכור.</small>
        </label>
        <label className="fld">
          <span>שוב את הסיסמה</span>
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
      </form>
    </>
  );
}
