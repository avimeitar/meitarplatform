"use client";

import { useState } from "react";
import { previewImportAction, runImportAction, type ImportPreview } from "@/app/actions/import";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/ui/Overlays";

export function ImportScreen({ projects, users }: { projects: { id: string; name: string }[]; users: { id: string; name: string; active: boolean }[] }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");

  async function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    setDone("");
    setPreview(null);
    setFileName(f.name);
    const text = await f.text();
    setCsv(text);
    setBusy(true);
    const r = await previewImportAction(text);
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.ok ? "משהו השתבש" : r.error);
    setPreview(r.data);
    setSources(Object.fromEntries(r.data.sources.map((s) => [s.source, s.projectId])));
    setOwners(Object.fromEntries(r.data.owners.map((o) => [o.name, o.userId])));
  }

  async function go() {
    setBusy(true);
    const r = await runImportAction(csv, { sources, owners });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.message ?? "הייבוא הסתיים");
    toast(r.message ?? "הייבוא הסתיים");
    setPreview(null);
    setCsv("");
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>ייבוא לידים מפיירברי</h1>
          <p className="sub">מייצאים מפיירברי את הלידים לקובץ CSV ומעלים אותו כאן. לפני הייבוא רואים מה ייכנס, ומחליטים לאיזה פרויקט שייך כל מקור ולמי שייך כל ליד.</p>
        </div>
      </div>
      <div className="panel">
        <label className="upload">
          <input type="file" accept=".csv,text/csv" className="sr" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
          <span className="bigbtn light">
            <Icon name="upload" />
            {fileName ? `קובץ: ${fileName}. לבחור קובץ אחר` : "לבחור קובץ CSV מפיירברי"}
          </span>
        </label>
        {busy && <p className="muted">קוראים את הקובץ…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {done && <p className="login-ok">{done}</p>}
      </div>
      {preview && (
        <>
          <div className="kpis" style={{ marginTop: 16 }}>
            <div className="kpi">
              <span>שורות בקובץ</span>
              <b>{preview.total}</b>
            </div>
            <div className="kpi">
              <span>לידים לייבוא</span>
              <b>{preview.valid - preview.existing}</b>
            </div>
            <div className="kpi">
              <span>כבר קיימים (יצורפו לכרטיס)</span>
              <b>{preview.existing}</b>
            </div>
            <div className="kpi">
              <span>בלי טלפון תקין (ידולגו)</span>
              <b>{preview.badPhone}</b>
            </div>
          </div>
          <div className="grid-2">
            <div className="panel">
              <h2>לאיזה פרויקט שייך כל מקור?</h2>
              <p className="muted">מילאנו הצעה לפי שם המקור. כדאי לבדוק, ובמקרה של ספק להשאיר ״לא ידוע״.</p>
              <table className="data map-table">
                <tbody>
                  {preview.sources.map((s) => (
                    <tr key={s.source}>
                      <td>
                        {s.source} <small>{s.count} לידים</small>
                      </td>
                      <td>
                        <select value={sources[s.source] ?? ""} onChange={(e) => setSources({ ...sources, [s.source]: e.target.value })} aria-label={`פרויקט עבור ${s.source}`}>
                          <option value="">לא ידוע</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h2>למי שייך כל ליד?</h2>
              <p className="muted">לפי ״מנהל לקוח״ בפיירברי. מי שלא קיים כאן יכול לקבל ליד שלא שויך, ואז אפשר לחלק אחר כך.</p>
              <table className="data map-table">
                <tbody>
                  {preview.owners.map((o) => (
                    <tr key={o.name}>
                      <td>
                        {o.name} <small>{o.count} לידים</small>
                      </td>
                      <td>
                        <select value={owners[o.name] ?? ""} onChange={(e) => setOwners({ ...owners, [o.name]: e.target.value })} aria-label={`משתמש עבור ${o.name}`}>
                          <option value="">לא לשייך</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                              {u.active ? "" : " (מושבת)"}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2 style={{ marginTop: 18 }}>איך יתורגמו הסטטוסים</h2>
              <ul className="map-list">
                {preview.statuses.map((s) => (
                  <li key={s.from}>
                    {s.from} <span className="muted">←</span> <b>{s.to}</b> <small className="muted">({s.count})</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <p>
              ייכנסו <b>{preview.valid - preview.existing}</b> לידים חדשים, ו-<b>{preview.existing}</b> פניות יצורפו ללידים שכבר קיימים במערכת. הכול נרשם ביומן הפעולות.
            </p>
            <div className="row-end">
              <button type="button" className="btn primary" disabled={busy} onClick={go}>
                {busy ? "מייבאים…" : "לייבא עכשיו"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
