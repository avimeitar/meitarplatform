"use client";

import Link from "next/link";
import { useState } from "react";
import { logWhatsAppAction, updateMeetingAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";
import { MeetingStateButtons, MeetingStatePill } from "@/components/crm/MeetingState";
import { meetingMessage, useLeadSheets, waLink, type SheetLead } from "@/components/crm/Sheets";
import { StatusPill } from "@/components/crm/bits";
import { useRunner } from "@/components/ui/useRunner";
import { OFFICE } from "@/lib/crm/constants";
import { dayFull, fD, fT, relTime } from "@/lib/crm/dates";

export type MeetingCardData = {
  id: string;
  startAt: string;
  createdAt: string;
  place: string;
  status: string;
  confirmed: boolean;
  note: string;
  subject: string;
  source: string;
  setByName: string | null;
  host: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  client: { name: string; leadId: string | null; phone: string; phoneRaw: string; email: string; status: string | null; ownerName: string | null };
  history: { id: string; text: string; at: string; by: string | null }[];
  canEdit: boolean;
};

type Option = { id: string; name: string };

export function MeetingCard({ m, people, projects }: { m: MeetingCardData; people: Option[]; projects: Option[] }) {
  const runner = useRunner();
  const sheets = useLeadSheets();
  const start = new Date(m.startAt);
  const fn = m.client.name.split(/\s+/)[0];
  const lead: SheetLead = { id: m.client.leadId ?? "", name: m.client.name, phoneRaw: m.client.phoneRaw, projectName: m.project?.name ?? "" };
  const wa = m.client.phoneRaw ? meetingMessage(lead, start, m.host?.name) : "";
  // the project list may not hold a project that was closed since
  const projectOptions = m.project && !projects.some((p) => p.id === m.project?.id) ? [m.project, ...projects] : projects;

  return (
    <section className="meeting-card">
      <Link className="back" href="/meetings">
        <Icon name="back" />
        לכל הפגישות
      </Link>
      <div className="lead-head mc-head">
        <span className="av lg" aria-hidden="true">
          <Icon name="cal" />
        </span>
        <div className="who">
          <h1>פגישה עם {m.client.name}</h1>
          <p className="meta">
            <span>
              {dayFull(start)} בשעה {fT(start)}
            </span>
            <span>{m.place || OFFICE.place}</span>
            <MeetingStatePill status={m.status} confirmed={m.confirmed} />
          </p>
        </div>
        <div className="lead-actions">
          {m.client.phoneRaw && (
            <a className="btn" href={`tel:${m.client.phoneRaw}`}>
              <Icon name="phone" />
              התקשרות
            </a>
          )}
          {wa && (
            <a className="btn wa" href={waLink(m.client.phoneRaw, wa)} target="_blank" rel="noopener noreferrer" onClick={() => m.client.leadId && runner(logWhatsAppAction(m.client.leadId, wa), { quiet: true })}>
              <Icon name="wa" />
              פרטי הפגישה בוואטסאפ
            </a>
          )}
          {m.canEdit && m.status !== "held" && (
            <button type="button" className="btn" onClick={() => sheets.book(lead, { meetingId: m.id })}>
              <Icon name="cal" />
              שינוי מועד
            </button>
          )}
          {m.client.leadId && (
            <Link className="btn ghost" href={`/leads/${m.client.leadId}`}>
              <Icon name="users" />
              לכרטיס הלקוח
            </Link>
          )}
        </div>
      </div>

      <div className="mc-grid">
        <div>
          <div className="panel">
            <div className="panel-head">
              <h2>סטטוס פגישה</h2>
            </div>
            <MeetingStateButtons m={m} disabled={!m.canEdit} />
            <p className="muted" style={{ marginTop: 10 }}>
              {m.client.leadId ? "הלקוח מתעדכן לבד: אחרי פגישה שהתקיימה נוספת שיחת המשך, ואחרי אי-הגעה, ביטול או ״לתאם מחדש״ נוצרת משימה לתאם מועד חדש." : "הפגישה לא מחוברת לכרטיס לקוח."}
            </p>
          </div>
          <Description id={m.id} note={m.note} canEdit={m.canEdit} />
          {m.client.leadId && (
            <div className="panel">
              <div className="panel-head">
                <h2>מה קרה עם הפגישות של {fn}</h2>
              </div>
              {m.history.length ? (
                <ol className="mc-hist">
                  {m.history.map((h) => (
                    <li key={h.id}>
                      {h.text}
                      <time suppressHydrationWarning>
                        {relTime(new Date(h.at))}
                        {h.by ? `, ${h.by}` : ""}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">עוד אין עדכונים.</p>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="panel">
            <div className="panel-head">
              <h2>פרטי הפגישה</h2>
            </div>
            <dl className="kv mc-kv">
              <dt>מתי</dt>
              <dd>
                {dayFull(start)} בשעה {fT(start)}
              </dd>
              <dt>איפה</dt>
              <dd>{m.place === OFFICE.place || !m.place ? OFFICE.address : m.place}</dd>
              <dt>פרויקט</dt>
              <dd>
                {m.canEdit ? (
                  <select aria-label="פרויקט" value={m.project?.id ?? ""} onChange={(e) => runner(updateMeetingAction(m.id, { projectId: e.target.value || null }))}>
                    <option value="">לא צוין</option>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  (m.project?.name ?? <span className="muted">לא צוין</span>)
                )}
              </dd>
              <dt>נפגשים עם</dt>
              <dd>
                {m.canEdit ? (
                  <select aria-label="נפגשים עם" value={m.host?.id ?? ""} onChange={(e) => e.target.value && runner(updateMeetingAction(m.id, { hostId: e.target.value }))}>
                    {!m.host && <option value="">לא נקבע</option>}
                    {(m.host && !people.some((p) => p.id === m.host?.id) ? [m.host, ...people] : people).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  (m.host?.name ?? <span className="muted">לא נקבע</span>)
                )}
              </dd>
              <dt>נקבעה ע״י</dt>
              <dd>{m.setByName ?? <span className="muted">לא ידוע</span>}</dd>
              <dt>נקבעה ב-</dt>
              <dd>
                {fD(new Date(m.createdAt))}.{new Date(m.createdAt).getFullYear()}, {fT(new Date(m.createdAt))}
              </dd>
              <dt>אישור הגעה</dt>
              <dd>{m.status === "set" ? (m.confirmed ? "ההגעה אושרה" : "עוד לא אושרה") : "—"}</dd>
              {m.source && (
                <>
                  <dt>מקור הגעה</dt>
                  <dd>{m.source}</dd>
                </>
              )}
              {m.subject && m.subject !== m.project?.name && (
                <>
                  <dt>נושא</dt>
                  <dd>{m.subject}</dd>
                </>
              )}
            </dl>
            {m.canEdit && m.client.leadId && <p className="muted mc-host-note">מי שנפגש עם הלקוח מנהל אותו. שינוי של ״נפגשים עם״ מעביר אליו גם את הלקוח.</p>}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>הלקוח</h2>
              {m.client.leadId && (
                <Link className="link" href={`/leads/${m.client.leadId}`}>
                  לכרטיס הלקוח
                </Link>
              )}
            </div>
            <dl className="kv">
              <dt>שם</dt>
              <dd>{m.client.name}</dd>
              {m.client.phone && (
                <>
                  <dt>טלפון</dt>
                  <dd>
                    <a className="ltr" href={`tel:${m.client.phoneRaw}`}>
                      {m.client.phone}
                    </a>
                  </dd>
                </>
              )}
              {m.client.email && (
                <>
                  <dt>אימייל</dt>
                  <dd className="ltr">{m.client.email}</dd>
                </>
              )}
              {m.client.status && (
                <>
                  <dt>סטטוס</dt>
                  <dd>
                    <StatusPill status={m.client.status} />
                  </dd>
                </>
              )}
              {m.client.leadId && (
                <>
                  <dt>מנהל לקוח</dt>
                  <dd>{m.client.ownerName ?? <span className="muted">לא שויך</span>}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The meeting's description: what it is about, what to prepare, anything worth knowing. */
function Description({ id, note, canEdit }: { id: string; note: string; canEdit: boolean }) {
  const runner = useRunner();
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== note.trim();
  return (
    <div className="panel mc-note">
      <div className="panel-head">
        <h2>תיאור</h2>
      </div>
      {canEdit ? (
        <>
          <label className="sr" htmlFor="mc-note">
            תיאור הפגישה
          </label>
          <textarea id="mc-note" value={text} maxLength={2000} placeholder="על מה הפגישה, מה להכין, מה חשוב לדעת" onChange={(e) => setText(e.target.value)} />
          <div className="row-end">
            <button
              type="button"
              className="btn primary"
              disabled={!changed || busy}
              onClick={async () => {
                setBusy(true);
                await runner(updateMeetingAction(id, { note: text }));
                setBusy(false);
              }}
            >
              {busy ? "שומרים…" : "שמירת התיאור"}
            </button>
          </div>
        </>
      ) : note ? (
        <p style={{ whiteSpace: "pre-wrap" }}>{note}</p>
      ) : (
        <p className="empty">אין תיאור.</p>
      )}
    </div>
  );
}
