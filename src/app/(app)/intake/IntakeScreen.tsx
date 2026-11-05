"use client";

import { useEffect, useRef, useState } from "react";
import { createApiKeyAction, revokeApiKeyAction, type NewApiKey } from "@/app/actions/intake";
import { Icon } from "@/components/Icon";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";

export type KeyRow = {
  id: string;
  name: string;
  source: string;
  project: string | null;
  masked: string;
  created: string;
  createdBy: string | null;
  lastUsed: string | null;
  active: boolean;
};
type ProjectOption = { id: string; name: string };
type FieldDoc = { field: string; label: string; also: string[]; required?: boolean };

/** Common sources, one tap away. Any other text can be typed, for example a lead vendor's name. */
const SOURCES = ["אתר החברה", "דף נחיתה", "פייסבוק", "אינסטגרם", "גוגל", "ספק לידים"];

function useCopy() {
  const toast = useToast();
  return async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("לא הצלחנו להעתיק. אפשר לסמן את הטקסט ולהעתיק ידנית");
    }
  };
}

export function IntakeScreen({ keys, projects, fields, endpoint }: { keys: KeyRow[]; projects: ProjectOption[]; fields: FieldDoc[]; endpoint: string }) {
  const drawer = useDrawer();
  const copy = useCopy();
  const active = keys.filter((k) => k.active);
  const revoked = keys.filter((k) => !k.active);

  function openNew() {
    drawer.open({ title: "מפתח חדש", content: <KeyForm projects={projects} endpoint={endpoint} /> });
  }

  function openRevoke(k: KeyRow) {
    drawer.open({ title: "ביטול מפתח", content: <RevokeConfirm k={k} /> });
  }

  return (
    <section className="ik">
      <div className="page-head">
        <div>
          <h1>קליטת לידים</h1>
          <p className="sub">לידים מהאתר, מדפי נחיתה, מספקי לידים ומפייסבוק ואינסטגרם (דרך Make או Zapier) נכנסים ישר למערכת. לכל מקור יש מפתח משלו.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn primary" onClick={openNew}>
            <Icon name="plus" />
            מפתח חדש
          </button>
        </div>
      </div>

      {active.length ? (
        <div className="panel flush">
          <KeyTable rows={active} onRevoke={openRevoke} />
        </div>
      ) : (
        <div className="panel ik-empty">
          <span className="ph-ic">
            <Icon name="link" />
          </span>
          <h2>{revoked.length ? "אין מפתחות פעילים" : "עוד אין מפתחות"}</h2>
          <p>יוצרים מפתח לכל מקור: האתר, דף נחיתה, ספק לידים, או פייסבוק ואינסטגרם דרך Make או Zapier. כל ליד שנשלח עם המפתח נכנס למערכת ולחלוקה האוטומטית.</p>
          <button type="button" className="btn primary" onClick={openNew}>
            <Icon name="plus" />
            מפתח חדש
          </button>
        </div>
      )}

      {revoked.length > 0 && (
        <>
          <h2 className="sec-h">מפתחות שבוטלו</h2>
          <div className="panel flush">
            <KeyTable rows={revoked} />
          </div>
        </>
      )}

      <h2 className="sec-h">פרטים טכניים לחיבור</h2>
      <div className="panel ik-tech">
        <div className="ik-block">
          <span className="ik-lbl">הכתובת לשליחת לידים</span>
          <div className="ik-line">
            <code className="ik-code">{endpoint}</code>
            <button type="button" className="btn" onClick={() => copy(endpoint, "הכתובת הועתקה")}>
              להעתיק
            </button>
          </div>
        </div>
        <p>
          שולחים בקשת <code className="ik-inline">POST</code> עם המפתח בכותרת <code className="ik-inline">Authorization: Bearer &lt;key&gt;</code> או בכותרת{" "}
          <code className="ik-inline">X-Api-Key</code>. הגוף הוא JSON או טופס רגיל, וכל בקשה היא ליד אחד.
        </p>
        <div className="ik-fields-wrap">
          <table className="data ik-fields">
            <thead>
              <tr>
                <th>שדה</th>
                <th>מה שולחים</th>
                <th>שמות נוספים שמתקבלים</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.field}>
                  <td>
                    <code className="ik-inline">{f.field}</code>
                  </td>
                  <td>{f.label}</td>
                  <td>
                    <span className="ltr">{f.also.join(", ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">טלפון שכבר קיים במערכת לא יוצר ליד כפול: הפנייה נוספת לכרטיס הקיים. כל מה שנשלח נשמר עם הפנייה, גם שדות שלא מופיעים כאן.</p>
        <h3>תשובות</h3>
        <ul className="ik-codes">
          <li>
            <code className="ik-inline">201</code> ליד חדש נשמר
          </li>
          <li>
            <code className="ik-inline">200</code> הטלפון כבר קיים, והפנייה נוספה לליד
          </li>
          <li>
            <code className="ik-inline">400</code> חסר טלפון, או שהגוף לא תקין. ההסבר מופיע בשדה <code className="ik-inline">error</code>
          </li>
          <li>
            <code className="ik-inline">401</code> המפתח חסר, שגוי או בוטל
          </li>
          <li>
            <code className="ik-inline">429</code> יותר מ-120 בקשות בדקה עם אותו מפתח
          </li>
        </ul>
        <h3>פייסבוק ואינסטגרם דרך Make או Zapier</h3>
        <p>
          ב-Make: מודול <span className="ltr">HTTP (Make a request)</span>. ב-Zapier: <span className="ltr">Webhooks by Zapier (POST)</span>. ממלאים את הכתובת, מוסיפים כותרת Authorization
          עם המילה Bearer והמפתח, ובגוף ממפים את שדות הליד מהטופס.
        </p>
      </div>
    </section>
  );
}

function KeyTable({ rows, onRevoke }: { rows: KeyRow[]; onRevoke?: (k: KeyRow) => void }) {
  return (
    <table className="data ik-keys">
      <thead>
        <tr>
          <th>שם</th>
          <th>מקור</th>
          <th>פרויקט</th>
          <th>מפתח</th>
          <th>נוצר</th>
          <th>שימוש אחרון</th>
          <th>
            <span className="sr">פעולות</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => (
          <tr key={k.id} className={k.active ? undefined : "ik-off"}>
            <td className="ik-name">
              <b>{k.name}</b>
            </td>
            <td data-label="מקור">{k.source}</td>
            <td data-label="פרויקט">{k.project ?? <span className="muted">בלי פרויקט קבוע</span>}</td>
            <td data-label="מפתח">
              <code className="ik-inline">{k.masked}</code>
            </td>
            <td data-label="נוצר">
              {k.created}
              {k.createdBy && <small>{k.createdBy}</small>}
            </td>
            <td data-label="שימוש אחרון">{k.lastUsed ?? <span className="muted">עוד לא היה שימוש</span>}</td>
            <td className="ik-act">
              {k.active ? (
                <button type="button" className="btn" onClick={() => onRevoke?.(k)}>
                  ביטול המפתח
                </button>
              ) : (
                <span className="st-pill s-lost">בוטל</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeyForm({ projects, endpoint }: { projects: ProjectOption[]; endpoint: string }) {
  const drawer = useDrawer();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [projectId, setProjectId] = useState("");
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr({ field: "name", text: "צריך לתת שם למפתח" });
    if (source.trim().length < 2) return setErr({ field: "source", text: "צריך לכתוב מאיפה מגיעים הלידים" });
    setBusy(true);
    const r = await createApiKeyAction({ name, source, projectId: projectId || null });
    setBusy(false);
    if (!r.ok) return setErr({ field: r.field, text: r.error });
    if (r.data) drawer.open({ title: "המפתח מוכן", content: <KeyReady info={r.data} endpoint={endpoint} sampleProject={projects[0]?.name ?? null} /> });
  }

  const fe = (f: string) =>
    err?.field === f ? (
      <small className="err ik-err" role="alert">
        {err.text}
      </small>
    ) : null;
  // a field's message goes away once it is being fixed
  const edit = (f: string, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    if (err?.field === f) setErr(null);
  };

  return (
    <form onSubmit={submit} noValidate className="ik-form">
      <label className="fld">
        <span className="req">שם המפתח</span>
        <input value={name} onChange={edit("name", setName)} autoComplete="off" maxLength={80} placeholder="למשל: טופס באתר החברה" aria-invalid={err?.field === "name"} />
        <small>כדי לזהות את החיבור ברשימה</small>
        {fe("name")}
      </label>
      <div className="fld">
        <span className="req" id="ik-src-label">
          מקור הלידים
        </span>
        <div className="chips ik-chips" role="group" aria-label="מקורות נפוצים">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className={source === s ? "on" : undefined}
              aria-pressed={source === s}
              onClick={() => {
                setSource(s);
                if (err?.field === "source") setErr(null);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={source}
          onChange={edit("source", setSource)}
          autoComplete="off"
          maxLength={60}
          placeholder="או לכתוב מקור אחר, למשל שם של ספק לידים"
          aria-labelledby="ik-src-label"
          aria-invalid={err?.field === "source"}
        />
        <small>כך יופיע המקור בכרטיס הליד, כשהליד לא שולח מקור משלו</small>
        {fe("source")}
      </div>
      <div className="fld">
        <span>פרויקט קבוע (לא חובה)</span>
        <div className="chips pchips" role="radiogroup" aria-label="פרויקט קבוע">
          <label>
            <input type="radio" className="sr" name="ik-project" checked={projectId === ""} onChange={() => setProjectId("")} />
            <span>בלי פרויקט קבוע</span>
          </label>
          {projects.map((p) => (
            <label key={p.id}>
              <input type="radio" className="sr" name="ik-project" checked={projectId === p.id} onChange={() => setProjectId(p.id)} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
        <small>לידים שלא מציינים פרויקט ייכנסו לפרויקט הזה</small>
        {fe("projectId")}
      </div>
      {err && !["name", "source", "projectId"].includes(err.field ?? "") && (
        <p className="form-error" role="alert">
          {err.text}
        </p>
      )}
      <footer>
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "יוצרים…" : "יצירת המפתח"}
        </button>
      </footer>
    </form>
  );
}

/** Wraps text in single quotes for a shell command. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function KeyReady({ info, endpoint, sampleProject }: { info: NewApiKey; endpoint: string; sampleProject: string | null }) {
  const drawer = useDrawer();
  const copy = useCopy();
  const top = useRef<HTMLDivElement>(null);
  // the drawer keeps the scroll position of the form it replaces: start at the warning
  useEffect(() => {
    top.current?.closest(".drawer-form")?.scrollTo(0, 0);
  }, []);
  const example: Record<string, unknown> = { name: "ישראל ישראלי", phone: "050-1234567", email: "israel@example.com" };
  if (!info.projectName && sampleProject) example.project = sampleProject;
  example.campaign = "summer-campaign";
  example.page = "https://meitargroup.co.il/";
  example.consent = true;
  const json = JSON.stringify(example, null, 2);
  const curl = [`curl -X POST "${endpoint}"`, `  -H "Authorization: Bearer ${info.key}"`, `  -H "Content-Type: application/json"`, `  -d ${shellQuote(JSON.stringify(example))}`].join(" \\\n");

  return (
    <div className="sheet-body ik-ready" ref={top}>
      <p className="warn-line">
        <Icon name="alert" />
        זו הפעם היחידה שהמפתח מוצג. כדאי להעתיק אותו עכשיו ולשמור במקום בטוח.
      </p>
      <div className="ik-block">
        <span className="ik-lbl">המפתח של ״{info.name}״</span>
        <code className="ik-code ik-secret">{info.key}</code>
        <button type="button" className="bigbtn light" onClick={() => copy(info.key, "המפתח הועתק")}>
          <Icon name="lock" />
          להעתיק את המפתח
        </button>
      </div>
      <div className="ik-block">
        <span className="ik-lbl">הכתובת לשליחת לידים</span>
        <code className="ik-code">{endpoint}</code>
        <button type="button" className="btn" onClick={() => copy(endpoint, "הכתובת הועתקה")}>
          להעתיק את הכתובת
        </button>
      </div>
      <div className="ik-block">
        <span className="ik-lbl">דוגמה מוכנה לבדיקה (curl)</span>
        <pre className="ik-code">{curl}</pre>
        <button type="button" className="btn" onClick={() => copy(curl, "הדוגמה הועתקה")}>
          להעתיק את הדוגמה
        </button>
        <small className="muted">הרצה של הדוגמה יוצרת ליד בדיקה אמיתי במערכת.</small>
      </div>
      <div className="ik-block">
        <span className="ik-lbl">גוף הבקשה (JSON)</span>
        <pre className="ik-code">{json}</pre>
        <button type="button" className="btn" onClick={() => copy(json, "גוף הבקשה הועתק")}>
          להעתיק את גוף הבקשה
        </button>
      </div>
      <p className="muted">
        לידים שלא שולחים מקור ייכנסו עם המקור ״{info.source}״{info.projectName ? <>, ולידים שלא שולחים פרויקט ייכנסו לפרויקט ״{info.projectName}״</> : null}.
      </p>
      <button type="button" className="btn primary full" onClick={drawer.close}>
        סיום
      </button>
    </div>
  );
}

function RevokeConfirm({ k }: { k: KeyRow }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    const r = await runner(revokeApiKeyAction(k.id));
    setBusy(false);
    if (r.ok) drawer.close();
  }

  return (
    <div className="sheet-body">
      <p className="confirm-q">לבטל את המפתח ״{k.name}״?</p>
      <p className="muted">מערכות שמשתמשות בו יפסיקו מיד להעביר לידים. אי אפשר להחזיר מפתח שבוטל, אבל אפשר ליצור מפתח חדש ולעדכן אותו במערכת ששולחת את הלידים.</p>
      {k.lastUsed && (
        <p className="warn-line">
          <Icon name="alert" />
          שימוש אחרון במפתח: {k.lastUsed}. כדאי לוודא שיש מפתח חדש במקומו.
        </p>
      )}
      {/* the drawer focuses its first button, so the safe choice comes first */}
      <button type="button" className="bigbtn light" onClick={drawer.close}>
        לא, לחזור
      </button>
      <button type="button" className="bigbtn danger" disabled={busy} onClick={revoke}>
        <Icon name="x" />
        {busy ? "מבטלים…" : "כן, לבטל את המפתח"}
      </button>
    </div>
  );
}
