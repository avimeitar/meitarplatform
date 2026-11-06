"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createLeadAction } from "@/app/actions/leads";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { MANUAL_SOURCES } from "@/lib/crm/constants";
import { normalizePhone } from "@/lib/phone";

export type ProjectOption = { id: string; name: string };
export type PersonOption = { id: string; name: string };

export function NewLeadForm({ projects, people, canAssign, me, prefill }: { projects: ProjectOption[]; people: PersonOption[]; canAssign: boolean; me: { id: string; name: string }; prefill?: string }) {
  const router = useRouter();
  const drawer = useDrawer();
  const toast = useToast();
  const digits = (prefill ?? "").replace(/\D/g, "");
  const [name, setName] = useState(digits.length >= 7 ? "" : (prefill ?? ""));
  const [phone, setPhone] = useState(digits.length >= 7 ? (prefill ?? "") : "");
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [source, setSource] = useState(MANUAL_SOURCES[0]);
  const [owner, setOwner] = useState(me.id);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr({ field: "name", text: "צריך לכתוב את השם של הלקוח" });
    if (!normalizePhone(phone)) return setErr({ field: "phone", text: "המספר לא נראה תקין. צריך 10 ספרות, למשל 050-1234567" });
    if (!projectId) return setErr({ field: "projectId", text: "צריך לבחור פרויקט" });
    setBusy(true);
    const r = await createLeadAction({ name, phone, email, projectId, source, owner, consent });
    setBusy(false);
    if (!r.ok) return setErr({ field: r.field, text: r.error });
    drawer.close();
    toast(r.message ?? "הליד נשמר", { undoId: r.undoId });
    if (r.data?.leadId) router.push(`/leads/${r.data.leadId}`);
  }

  const fieldErr = (f: string) =>
    err && err.field === f ? (
      <small className="err" role="alert">
        {err.text}
      </small>
    ) : null;

  return (
    <form onSubmit={submit} noValidate>
      <label className="fld">
        <span className="req">שם מלא</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="לדוגמה: ישראל ישראלי" aria-invalid={err?.field === "name"} />
        {fieldErr("name")}
      </label>
      <label className="fld">
        <span className="req">טלפון</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" autoComplete="off" placeholder="050-1234567" aria-invalid={err?.field === "phone"} />
        <small>אם הטלפון כבר קיים, הפנייה תתווסף לכרטיס הקיים</small>
        {fieldErr("phone")}
      </label>
      <label className="fld">
        <span>אימייל</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" autoComplete="off" aria-invalid={err?.field === "email"} />
        {fieldErr("email")}
      </label>
      <div className="fld">
        <span className="req">פרויקט</span>
        <div className="chips pchips" role="radiogroup" aria-label="פרויקט">
          {projects.map((p) => (
            <label key={p.id}>
              <input type="radio" className="sr" name="proj" value={p.id} checked={projectId === p.id} onChange={() => setProjectId(p.id)} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
        {fieldErr("projectId")}
      </div>
      <label className="fld">
        <span>מקור הגעה</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {MANUAL_SOURCES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="fld">
        <span>מי מטפל</span>
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value={me.id}>{me.name} (אני)</option>
          <option value="auto">חלוקה אוטומטית בין הסוכנים</option>
          {canAssign &&
            people
              .filter((p) => p.id !== me.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
        </select>
        {fieldErr("owner")}
      </label>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        יש אישור לקבל מידע שיווקי
      </label>
      {err && !["name", "phone", "email", "projectId", "owner"].includes(err.field ?? "") && (
        <p className="form-error" role="alert">
          {err.text}
        </p>
      )}
      <footer>
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "שומרים…" : "שמירת ליד"}
        </button>
      </footer>
    </form>
  );
}
