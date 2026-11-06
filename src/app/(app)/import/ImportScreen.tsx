"use client";

import Link from "next/link";
import { useState } from "react";
import { previewImportAction, runImportAction, runMeetingsImportAction, type ImportPreview, type LeadsPreview, type MeetingsPreview } from "@/app/actions/import";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/ui/Overlays";

type Ref = { id: string; name: string };
type Person = Ref & { active: boolean };

// the server takes up to 15 MB per request; Hebrew text takes two bytes a letter once it is sent
const MAX_BYTES = 14_500_000;
const TOO_BIG = "הקבצים גדולים מדי לייבוא אחד. אפשר לייבא אותם בכמה פעמים, קובץ או שניים בכל פעם";
const FAILED = "הייבוא לא הצליח. ייתכן שהחיבור נפל או שהקבצים גדולים מדי. אפשר לנסות שוב, או לייבא בכמה פעמים";
const FIRST_SUBJECTS = 12;

/** Fireberry exports are UTF-8. A file saved again in Excel on a Hebrew computer can be Windows-1255. */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1255").decode(buf);
  }
}

export function ImportScreen({ projects, users }: { projects: Ref[]; users: Person[] }) {
  const toast = useToast();
  const [files, setFiles] = useState<string[]>([]);
  const [names, setNames] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [map, setMap] = useState<{ a: Record<string, string>; b: Record<string, string> }>({ a: {}, b: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ text: string; kind: ImportPreview["kind"] } | null>(null);

  async function pick(chosen: File[]) {
    if (!chosen.length) return;
    setError("");
    setDone(null);
    setPreview(null);
    setNames(chosen.length > 1 ? `${chosen.length} קבצים` : chosen[0].name);
    const texts = await Promise.all(chosen.map(readText));
    if (new Blob([JSON.stringify(texts)]).size > MAX_BYTES) return setError(TOO_BIG);
    setFiles(texts);
    setBusy(true);
    const r = await previewImportAction(texts).catch(() => null);
    setBusy(false);
    if (!r) return setError(FAILED);
    if (!r.ok || !r.data) return setError(r.ok ? "משהו השתבש" : r.error);
    const p = r.data;
    setPreview(p);
    if (p.kind === "leads") setMap({ a: Object.fromEntries(p.sources.map((s) => [s.source, s.projectId])), b: Object.fromEntries(p.owners.map((o) => [o.name, o.userId])) });
    else setMap({ a: Object.fromEntries(p.subjects.map((s) => [s.subject, s.projectId])), b: Object.fromEntries(p.reps.map((o) => [o.name, o.userId])) });
  }

  async function go() {
    if (!preview) return;
    setBusy(true);
    setError("");
    const r = await (preview.kind === "leads" ? runImportAction(files, { sources: map.a, owners: map.b }) : runMeetingsImportAction(files, { subjects: map.a, reps: map.b })).catch(() => null);
    setBusy(false);
    if (!r) return setError(FAILED);
    if (!r.ok) return setError(r.error);
    const text = r.message ?? "הייבוא הסתיים";
    setDone({ text, kind: preview.kind });
    toast(text);
    setPreview(null);
    setFiles([]);
  }

  const setA = (k: string, v: string) => setMap((m) => ({ ...m, a: { ...m.a, [k]: v } }));
  const setB = (k: string, v: string) => setMap((m) => ({ ...m, b: { ...m.b, [k]: v } }));

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>ייבוא מפיירברי</h1>
          <p className="sub">מייצאים מפיירברי קובץ CSV של לידים או של פגישות, ומעלים אותו כאן. אפשר לבחור כמה קבצים יחד. לפני הייבוא רואים מה ייכנס.</p>
        </div>
      </div>
      <div className="panel">
        <label className="upload">
          <input type="file" multiple accept=".csv,text/csv" className="sr" onChange={(e) => {
              const chosen = e.target.files ? [...e.target.files] : [];
              e.target.value = ""; // choosing the same file again still works
              pick(chosen);
            }} disabled={busy} />
          <span className="bigbtn light">
            <Icon name="upload" />
            {names ? `נבחרו: ${names}. אפשר לבחור אחרים` : "לבחור קבצים מפיירברי (CSV)"}
          </span>
        </label>
        {busy && <p className="muted">{preview ? "מייבאים…" : "קוראים את הקבצים…"}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="login-ok" role="status">
            {done.text}.{" "}
            <Link className="link" href={done.kind === "meetings" ? "/meetings?range=past&who=all" : "/leads"}>
              {done.kind === "meetings" ? "לרשימת הפגישות" : "לרשימת הלידים"}
            </Link>
          </p>
        )}
      </div>
      {preview?.kind === "leads" && <LeadsStep p={preview} projects={projects} users={users} map={map} setA={setA} setB={setB} busy={busy} go={go} />}
      {preview?.kind === "meetings" && <MeetingsStep p={preview} projects={projects} users={users} map={map} setA={setA} setB={setB} busy={busy} go={go} />}
    </section>
  );
}

type StepProps<P> = { p: P; projects: Ref[]; users: Person[]; map: { a: Record<string, string>; b: Record<string, string> }; setA: (k: string, v: string) => void; setB: (k: string, v: string) => void; busy: boolean; go: () => void };

function ProjectSelect({ value, onChange, label, projects }: { value: string; onChange: (v: string) => void; label: string; projects: Ref[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">לא ידוע</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function UserSelect({ value, onChange, label, users, none }: { value: string; onChange: (v: string) => void; label: string; users: Person[]; none: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{none}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.active ? "" : " (מושבת)"}
        </option>
      ))}
    </select>
  );
}

function Statuses({ list }: { list: { from: string; count: number; to: string }[] }) {
  return (
    <>
      <h2 style={{ marginTop: 18 }}>איך יתורגמו הסטטוסים</h2>
      <ul className="map-list">
        {list.map((s) => (
          <li key={s.from}>
            {s.from} <span className="muted">←</span> <b>{s.to}</b> <small className="muted">({s.count})</small>
          </li>
        ))}
      </ul>
    </>
  );
}

function LeadsStep({ p, projects, users, map, setA, setB, busy, go }: StepProps<LeadsPreview>) {
  const fresh = p.valid - p.existing;
  return (
    <>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="kpi">
          <span>שורות {p.files > 1 ? `ב-${p.files} הקבצים` : "בקובץ"}</span>
          <b>{p.total}</b>
        </div>
        <div className="kpi">
          <span>לידים לייבוא</span>
          <b>{fresh}</b>
        </div>
        <div className="kpi">
          <span>כבר קיימים (יצורפו לכרטיס)</span>
          <b>{p.existing}</b>
        </div>
        <div className="kpi">
          <span>בלי טלפון תקין (ידולגו)</span>
          <b>{p.badPhone}</b>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h2>לאיזה פרויקט שייך כל מקור?</h2>
          <p className="muted">מילאנו הצעה לפי שם המקור. כדאי לבדוק, ובמקרה של ספק להשאיר ״לא ידוע״.</p>
          <table className="data map-table">
            <tbody>
              {p.sources.map((s) => (
                <tr key={s.source}>
                  <td>
                    {s.source} <small>{s.count} לידים</small>
                  </td>
                  <td>
                    <ProjectSelect value={map.a[s.source] ?? ""} onChange={(v) => setA(s.source, v)} label={`פרויקט עבור ${s.source}`} projects={projects} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>למי שייך כל ליד?</h2>
          <p className="muted">לפי ״מנהל לקוח״ בפיירברי. אם מנהל הלקוח לא קיים כאן, הליד ייכנס בלי שיוך, ואפשר לשייך אותו אחר כך.</p>
          <table className="data map-table">
            <tbody>
              {p.owners.map((o) => (
                <tr key={o.name}>
                  <td>
                    {o.name} <small>{o.count} לידים</small>
                  </td>
                  <td>
                    <UserSelect value={map.b[o.name] ?? ""} onChange={(v) => setB(o.name, v)} label={`משתמש עבור ${o.name}`} users={users} none="לא לשייך" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Statuses list={p.statuses} />
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <p>
          ייכנסו <b>{fresh}</b> לידים חדשים, ו-<b>{Math.max(0, p.existing - p.already)}</b> פניות יצורפו ללידים שכבר קיימים במערכת.
          {p.already ? ` ${p.already} שורות כבר יובאו בעבר ולא ייכנסו שוב.` : ""} הכול נרשם ביומן הפעולות.
        </p>
        <div className="row-end">
          <button type="button" className="btn primary" disabled={busy} onClick={go}>
            {busy ? "מייבאים…" : "לייבא עכשיו"}
          </button>
        </div>
      </div>
    </>
  );
}

function MeetingsStep({ p, projects, users, map, setA, setB, busy, go }: StepProps<MeetingsPreview>) {
  const [all, setAll] = useState(false);
  const fresh = p.valid - p.existing;
  const again = p.existing + p.dupInFile;
  const subjects = all ? p.subjects : p.subjects.slice(0, FIRST_SUBJECTS);
  return (
    <>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="kpi">
          <span>פגישות {p.files > 1 ? `ב-${p.files} הקבצים` : "בקובץ"}</span>
          <b>{p.total}</b>
        </div>
        <div className="kpi">
          <span>פגישות חדשות לייבוא</span>
          <b>{fresh}</b>
        </div>
        <div className="kpi">
          <span>כבר במערכת או פעמיים בקבצים</span>
          <b>{again}</b>
        </div>
        <div className="kpi">
          <span>פגישות קרובות שנקבעו</span>
          <b>{p.upcoming}</b>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h2>מי הנציג של כל פגישה?</h2>
          <p className="muted">לפי ״שם נציג״ בפיירברי. אם הנציג עוד לא משתמש כאן, הפגישה נשמרת עם השם שלו מפיירברי.</p>
          <table className="data map-table">
            <tbody>
              {p.reps.map((o) => (
                <tr key={o.name}>
                  <td>
                    {o.name} <small>{o.count === 1 ? "פגישה אחת" : `${o.count} פגישות`}</small>
                  </td>
                  <td>
                    <UserSelect value={map.b[o.name] ?? ""} onChange={(v) => setB(o.name, v)} label={`משתמש עבור ${o.name}`} users={users} none="לא לשייך" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Statuses list={p.statuses} />
        </div>
        <div className="panel">
          <h2>לאיזה פרויקט שייכת כל פגישה?</h2>
          <p className="muted">לפי הנושא בפיירברי. מילאנו הצעה רק כשהנושא ברור. הנושא עצמו נשמר בכל פגישה.</p>
          <table className="data map-table">
            <tbody>
              {subjects.map((s) => (
                <tr key={s.subject}>
                  <td>
                    {s.subject} <small>{s.count === 1 ? "פגישה אחת" : `${s.count} פגישות`}</small>
                  </td>
                  <td>
                    <ProjectSelect value={map.a[s.subject] ?? ""} onChange={(v) => setA(s.subject, v)} label={`פרויקט עבור ${s.subject}`} projects={projects} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.subjects.length > FIRST_SUBJECTS && (
            <button type="button" className="link" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
              {all ? "להציג פחות" : `להציג את כל הנושאים (עוד ${p.subjects.length - FIRST_SUBJECTS})`}
            </button>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <p>
          {fresh ? (
            <>
              ייכנסו <b>{fresh}</b> פגישות.{" "}
            </>
          ) : (
            "כל הפגישות בקבצים כבר נמצאות במערכת. "
          )}
          כל פגישה נשמרת בפני עצמה, עם שם הלקוח והנושא מפיירברי, בלי ליד ובלי טלפון. רואים אותן במסך הפגישות.
          {p.noDate ? ` ${p.noDate} שורות בלי תאריך ידולגו.` : ""}
        </p>
        <div className="row-end">
          <button type="button" className="btn primary" disabled={busy || !fresh} onClick={go}>
            {busy ? "מייבאים…" : fresh === 1 ? "לייבא פגישה אחת" : `לייבא ${fresh} פגישות`}
          </button>
        </div>
      </div>
    </>
  );
}
