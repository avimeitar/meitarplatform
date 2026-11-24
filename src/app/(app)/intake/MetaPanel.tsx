"use client";

import { useState } from "react";
import { createMetaInviteAction, disconnectPageAction, pullMetaLeadsAction, revokeMetaInviteAction, setFormProjectAction } from "@/app/actions/meta";
import { Icon } from "@/components/Icon";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";

export type MetaPanelData = {
  configured: boolean;
  status: { kind: string; pages?: string; subscribed?: string; why?: string } | null;
  setup: { webhook: string; callback: string; privacy: string; deletion: string; domain: string; verifyToken: string };
  pages: {
    id: string;
    name: string;
    active: boolean;
    supplier: string | null;
    source: string | null;
    lastLead: string | null;
    lastError: string | null;
    forms: { id: string; name: string; projectId: string | null; leads: number; lastLead: string | null }[];
  }[];
  invites: { id: string; supplier: string; source: string; project: string | null; expires: string; used: boolean }[];
  projects: { id: string; name: string }[];
};

function useCopy() {
  const toast = useToast();
  return async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("לא הצלחנו להעתיק. אפשר לסמן ולהעתיק ידנית", { error: true });
    }
  };
}

const STATUS: Record<string, [string, boolean]> = {
  connected: ["החיבור לפייסבוק הצליח. הלידים מ-90 הימים האחרונים נמשכים עכשיו ברקע.", false],
  denied: ["החיבור לא הושלם: לא אושרה הגישה בפייסבוק.", true],
  nopages: ["לא נבחר אף עמוד בפייסבוק. אפשר לחבר שוב ולבחור עמוד.", true],
  expired: ["החיבור לקח יותר מדי זמן. אפשר לנסות שוב.", true],
  setup: ["החיבור לפייסבוק עוד לא הוגדר ב-Railway.", true],
  failed: ["פייסבוק לא אישר את החיבור.", true],
};

/** Facebook and Instagram Lead Ads, straight into the system: the company's pages, and suppliers' pages by invite. */
export function MetaPanel({ d }: { d: MetaPanelData }) {
  const runner = useRunner();
  const drawer = useDrawer();
  const copy = useCopy();
  const [pulling, setPulling] = useState(false);
  const st = d.status ? STATUS[d.status.kind] : null;
  const own = d.pages.filter((p) => !p.supplier);
  const suppliers = d.pages.filter((p) => p.supplier);

  return (
    <section className="meta" id="meta">
      <h2 className="sec-h">פייסבוק ואינסטגרם: לידים ישירות מטפסי הלידים</h2>
      {st && (
        <p className={"warn-line" + (st[1] ? "" : " ok-line")} role="status">
          <Icon name={st[1] ? "alert" : "check"} />
          <span>
            {st[0]}
            {d.status?.kind === "connected" && d.status.pages ? ` עמודים שחוברו: ${d.status.pages}.` : ""}
            {d.status?.why ? ` (${d.status.why})` : ""}
          </span>
        </p>
      )}

      {!d.configured ? (
        <div className="panel">
          <h3>החיבור הישיר עוד לא הוגדר</h3>
          <p className="muted">
            צריך ליצור אפליקציה של Meta ולהוסיף ב-Railway את המשתנים <code className="ik-inline">META_APP_ID</code>, <code className="ik-inline">META_APP_SECRET</code> ו-
            <code className="ik-inline">META_LOGIN_CONFIG_ID</code>. ההוראות המלאות בקובץ docs/META_SETUP.md. אלה הערכים שמזינים באפליקציה:
          </p>
          <SetupValues s={d.setup} copy={copy} />
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h3>העמודים של קבוצת מיתר</h3>
              <div className="meta-acts">
                <a className="btn primary" href="/api/meta/connect">
                  <Icon name="link" />
                  {own.length ? "חיבור עמוד נוסף" : "חיבור לפייסבוק"}
                </a>
                {d.pages.some((p) => p.active) && (
                  <button
                    type="button"
                    className="btn"
                    disabled={pulling}
                    onClick={async () => {
                      setPulling(true);
                      await runner(pullMetaLeadsAction());
                      setPulling(false);
                    }}
                  >
                    {pulling ? "מושכים…" : "משיכת לידים מ-90 הימים האחרונים"}
                  </button>
                )}
              </div>
            </div>
            {own.length ? <Pages pages={own} projects={d.projects} /> : <p className="empty">עוד לא חובר עמוד. ״חיבור לפייסבוק״ פותח את פייסבוק, ושם בוחרים את העמודים של קבוצת מיתר.</p>}
            <p className="muted meta-note">ליד חדש מטופס נכנס תוך שניות. כל 10 דקות המערכת בודקת גם בעצמה שלא פספסה ליד, וכל ליד נקלט פעם אחת בלבד.</p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>ספקי לידים עם חשבון מודעות משלהם</h3>
              <button type="button" className="btn" onClick={() => drawer.open({ title: "קישור חיבור לספק", content: <InviteForm projects={d.projects} copy={copy} /> })}>
                <Icon name="plus" />
                קישור חיבור לספק
              </button>
            </div>
            <p className="muted">
              הספק פותח את הקישור, לוחץ ״התחברות עם פייסבוק״ ובוחר את העמוד שלו. מאז הלידים מהטפסים שלו נכנסים לבד, עם המקור והפרויקט שקבעתם, בלי Make.
            </p>
            {suppliers.length > 0 && <Pages pages={suppliers} projects={d.projects} />}
            {d.invites.length > 0 && (
              <table className="data meta-invites">
                <thead>
                  <tr>
                    <th>ספק</th>
                    <th>מקור</th>
                    <th>פרויקט</th>
                    <th>בתוקף עד</th>
                    <th>
                      <span className="sr">פעולות</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.invites.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{i.supplier}</b>
                        {i.used && <small className="muted"> · התחבר</small>}
                      </td>
                      <td data-label="מקור">{i.source}</td>
                      <td data-label="פרויקט">{i.project ?? <span className="muted">לפי הטופס</span>}</td>
                      <td data-label="בתוקף עד">{i.expires}</td>
                      <td>
                        <button type="button" className="btn sm ghost" onClick={() => runner(revokeMetaInviteAction(i.id))}>
                          ביטול הקישור
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <details className="ik-more">
            <summary>הערכים שמוגדרים באפליקציה של Meta</summary>
            <SetupValues s={d.setup} copy={copy} />
          </details>
        </>
      )}
    </section>
  );
}

function SetupValues({ s, copy }: { s: MetaPanelData["setup"]; copy: (t: string, m: string) => void }) {
  const rows: [string, string][] = [
    ["Webhook: Callback URL", s.webhook],
    ["Webhook: Verify token", s.verifyToken],
    ["Facebook Login: Valid OAuth Redirect URI", s.callback],
    ["App domain", s.domain],
    ["Privacy Policy URL", s.privacy],
    ["User data deletion URL", s.deletion],
  ];
  return (
    <dl className="meta-setup">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            <code className="ik-code">{v}</code>
            <button type="button" className="btn sm" onClick={() => copy(v, "הועתק")}>
              להעתיק
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Pages({ pages, projects }: { pages: MetaPanelData["pages"]; projects: MetaPanelData["projects"] }) {
  const runner = useRunner();
  return (
    <ul className="meta-pages">
      {pages.map((p) => (
        <li key={p.id} className={p.active ? undefined : "off"}>
          <div className="meta-page-head">
            <b>{p.name}</b>
            {p.supplier && <span className="st-pill s-work">{p.supplier}</span>}
            <span className="muted">{p.active ? (p.lastLead ? `ליד אחרון: ${p.lastLead}` : "עוד לא הגיע ליד") : "מנותק"}</span>
            {p.active && (
              <button type="button" className="btn sm ghost" onClick={() => runner(disconnectPageAction(p.id))}>
                ניתוק
              </button>
            )}
          </div>
          {p.lastError && p.active && (
            <p className="warn-line">
              <Icon name="alert" />
              <span>{p.lastError}</span>
            </p>
          )}
          {p.forms.length > 0 && (
            <table className="data meta-forms">
              <thead>
                <tr>
                  <th>טופס</th>
                  <th>לידים</th>
                  <th>לאיזה פרויקט</th>
                </tr>
              </thead>
              <tbody>
                {p.forms.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.name}
                      {f.lastLead && <small className="muted"> · אחרון {f.lastLead}</small>}
                    </td>
                    <td data-label="לידים" className="num">
                      {f.leads}
                    </td>
                    <td data-label="פרויקט">
                      <label className="sel">
                        <span className="sr">פרויקט לטופס {f.name}</span>
                        <select value={f.projectId ?? ""} onChange={(e) => runner(setFormProjectAction(f.id, e.target.value || null))}>
                          <option value="">{p.supplier ? "הפרויקט של הספק" : "בלי פרויקט קבוע"}</option>
                          {projects.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      ))}
    </ul>
  );
}

function InviteForm({ projects, copy }: { projects: MetaPanelData["projects"]; copy: (t: string, m: string) => void }) {
  const [supplier, setSupplier] = useState("");
  const [source, setSource] = useState("");
  const [projectId, setProjectId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const message = link
    ? `שלום ${supplier},\nזה הקישור לחיבור הלידים מהעמוד שלכם בפייסבוק לקבוצת מיתר:\n${link}\n\nפותחים, לוחצים ״התחברות עם פייסבוק״ עם המשתמש שמנהל את העמוד, ובוחרים את העמוד. מאז כל ליד מהטפסים יגיע אלינו לבד.\nהקישור בתוקף 30 יום.`
    : "";

  if (link)
    return (
      <div className="sheet-body ik-ready">
        <div className="ik-block">
          <span className="ik-lbl">הקישור של {supplier}</span>
          <code className="ik-code ik-secret">{link}</code>
          <small className="muted">מוצג פעם אחת. בתוקף 30 יום, ואפשר לבטל אותו בכל רגע.</small>
        </div>
        <div className="ik-send">
          <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
            <Icon name="wa" />
            בוואטסאפ
          </a>
          <a className="btn" href={`mailto:?subject=${encodeURIComponent("חיבור לידים מפייסבוק לקבוצת מיתר")}&body=${encodeURIComponent(message)}`}>
            <Icon name="mail" />
            במייל
          </a>
          <button type="button" className="btn ghost" onClick={() => copy(link, "הקישור הועתק")}>
            להעתיק את הקישור
          </button>
        </div>
      </div>
    );

  return (
    <form
      className="sheet-body"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        if (supplier.trim().length < 2) return setErr("צריך לכתוב את שם הספק");
        setBusy(true);
        const r = await createMetaInviteAction({ supplier, source: source.trim() || supplier, projectId: projectId || null });
        setBusy(false);
        if (!r.ok) return setErr(r.error);
        if (r.data) setLink(r.data.link);
      }}
    >
      <label className="fld">
        <span className="req">שם הספק</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={80} autoComplete="off" />
      </label>
      <label className="fld">
        <span>מקור, כמו שיופיע בכרטיס הלקוח</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={60} placeholder={supplier || "למשל: צביקה - פייסבוק"} autoComplete="off" />
        <small>ריק: שם הספק</small>
      </label>
      <label className="fld">
        <span>פרויקט (לא חובה)</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">לפי הטופס</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      <button type="submit" className="btn primary full" disabled={busy}>
        {busy ? "יוצרים…" : "יצירת הקישור"}
      </button>
    </form>
  );
}
