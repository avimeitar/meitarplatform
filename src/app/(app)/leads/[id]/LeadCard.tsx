"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addNoteAction, addTaskAction, assignLeadAction, confirmMeetingAction, deleteLeadAction, logWhatsAppAction, meetingStatusAction, setLeadStatusAction, updateLeadAction } from "@/app/actions/leads";
import { Icon, type IconName } from "@/components/Icon";
import { firstName, initials, StatusPill } from "@/components/crm/bits";
import { readyMessages, useLeadSheets, waLink, type SheetLead } from "@/components/crm/Sheets";
import { TaskList, type TaskItem } from "@/components/crm/TaskList";
import { useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { MAIN, MS, REASONS, ST, type LeadStatus, type MeetingStatus } from "@/lib/crm/constants";
import { addDays, dayLabel, fD, fT, iso, nextWorkday, relTime, sod } from "@/lib/crm/dates";

export type Activity = { id: string; kind: string; direction: string | null; text: string; auto: string | null; tags: string[]; userName: string | null; createdAt: string };
export type MeetingItem = { id: string; startAt: string; place: string; status: string; confirmed: boolean; projectName: string; setByName: string | null; hostName: string | null; canEdit: boolean };
export type LeadCardData = {
  id: string;
  name: string;
  phone: string;
  phoneRaw: string;
  email: string;
  source: string;
  projectId: string;
  projectName: string;
  status: string;
  lostReason: string | null;
  ownerId: string | null;
  ownerName: string | null;
  attempts: number;
  nextAt: string | null;
  createdAt: string;
  inquiries: number;
  consent: boolean;
  activities: Activity[];
  meetings: MeetingItem[];
  tasks: TaskItem[];
};

const EV_ICON: Record<string, IconName> = { in: "in", call: "phone", miss: "phone-x", wa: "wa", status: "flag", meeting: "cal", note: "note", task: "check", system: "zap" };

export function LeadCard({ lead, projects, people, perms, meId }: { lead: LeadCardData; projects: { id: string; name: string }[]; people: { id: string; name: string }[]; perms: { edit: boolean; assign: boolean; del: boolean; assignTasks: boolean }; meId: string }) {
  const router = useRouter();
  const sheets = useLeadSheets();
  const runner = useRunner();
  const toast = useToast();
  const [lostOpen, setLostOpen] = useState(false);
  const [tab, setTab] = useState<"wa" | "call" | "note" | "task">("wa");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sl: SheetLead = { id: lead.id, name: lead.name, phoneRaw: lead.phoneRaw, projectName: lead.projectName };
  const fn = firstName(lead.name);
  const status = lead.status as LeadStatus;
  const mi = MAIN.indexOf(status);
  const anchor = mi >= 0 ? mi : status === "noans" ? 1 : status === "resched" ? 2 : lead.meetings.some((m) => m.status === "held") ? 3 : lead.meetings.length ? 2 : 1;

  function setStatus(s: LeadStatus) {
    if (!perms.edit) return;
    if (s === "lost") return setLostOpen((v) => !v);
    setLostOpen(false);
    if (s === lead.status && s !== "noans") return;
    if (s === "won") return sheets.won(sl);
    runner(setLeadStatusAction(lead.id, s));
  }

  async function remove() {
    const r = await runner(deleteLeadAction(lead.id));
    if (r.ok) router.push("/leads");
  }

  return (
    <section>
      <Link className="back" href="/leads">
        <Icon name="back" />
        לכל הלידים
      </Link>
      <div className="lead-head">
        <span className={"av lg" + (lead.ownerName ? "" : " ghost")}>{initials(lead.name)}</span>
        <div className="who">
          <h1>{lead.name}</h1>
          <p className="meta">
            <a className="ltr" href={`tel:${lead.phoneRaw}`}>
              {lead.phone}
            </a>
            {lead.email && <span className="ltr">{lead.email}</span>}
            {lead.projectName && <span>{lead.projectName}</span>}
            <span>מקור: {lead.source}</span>
            <span>נכנס {relTime(new Date(lead.createdAt))}</span>
            {lead.inquiries > 1 && <span>{lead.inquiries} פניות</span>}
          </p>
        </div>
        {perms.edit && (
          <div className="lead-actions">
            <a className="btn" href={`tel:${lead.phoneRaw}`} onClick={() => sheets.afterCall(sl)}>
              <Icon name="phone" />
              התקשרות
            </a>
            <button type="button" className="btn wa" onClick={() => sheets.wa(sl)}>
              <Icon name="wa" />
              וואטסאפ
            </button>
            <button type="button" className="btn" onClick={() => sheets.book(sl)}>
              <Icon name="cal" />
              קביעת פגישה
            </button>
            <button type="button" className="btn ghost" onClick={() => setTab("task")}>
              <Icon name="check" />
              משימה
            </button>
          </div>
        )}
      </div>

      <div className="panel line-panel">
        <ol className="metro" aria-label="שלב הליד. לחיצה על תחנה משנה את הסטטוס">
          {MAIN.map((s, i) => {
            const cls = mi >= 0 ? (i < mi ? "done" : i === mi ? "current" : "todo") : i <= anchor ? "done" : "todo";
            return (
              <li key={s} className={cls}>
                <button type="button" className="stbtn" disabled={!perms.edit} aria-current={cls === "current" ? "step" : undefined} onClick={() => setStatus(s)}>
                  <span className="dot" />
                  <span className="lbl">{ST[s].l}</span>
                  <small>{s === "new" ? fD(new Date(lead.createdAt)) : " "}</small>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="exits">
          <span className="muted">מצב אחר:</span>
          {(["noans", "resched", "lost"] as LeadStatus[]).map((s) => {
            const on = lead.status === s;
            return (
              <button key={s} type="button" className={"exit " + (on ? "on " + ST[s].c : "")} aria-pressed={on} disabled={!perms.edit} onClick={() => setStatus(s)}>
                {ST[s].l}
                {on && s === "lost" && lead.lostReason ? `: ${lead.lostReason}` : ""}
              </button>
            );
          })}
          {lead.attempts > 0 && (
            <span className="att">
              <Icon name="phone-x" />
              {lead.attempts >= 3 ? `${lead.attempts} ניסיונות בלי מענה` : `ניסיון ${lead.attempts} מתוך 3 בלי מענה`}
            </span>
          )}
        </div>
        {lostOpen && (
          <div className="reasons" role="group" aria-label="סיבה">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={lead.lostReason === r ? "on" : ""}
                onClick={() => {
                  setLostOpen(false);
                  runner(setLeadStatusAction(lead.id, "lost", r));
                }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lead-grid">
        <aside className="details-col">
          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 4 }}>
              <h3>פגישות</h3>
              {perms.edit && (
                <button type="button" className="btn sm" onClick={() => sheets.book(sl)}>
                  <Icon name="plus" />
                  פגישה
                </button>
              )}
            </div>
            {lead.meetings.length ? (
              lead.meetings.map((m) => <MeetingRow key={m.id} m={m} lead={sl} canEdit={perms.edit && m.canEdit} />)
            ) : (
              <p className="empty">עדיין אין פגישות. פגישה שתתואם תעביר את הליד ל״נקבעה פגישה״.</p>
            )}
          </div>
          <Details lead={lead} projects={projects} people={people} perms={perms} />
          <div className="panel">
            <h3>משימות פתוחות</h3>
            <TaskList tasks={lead.tasks} showUser empty="אין משימות פתוחות." />
          </div>
          {perms.del && (
            <div className="panel">
              {confirmDelete ? (
                <>
                  <p className="confirm-q">למחוק את {lead.name}?</p>
                  <p className="muted">הליד, ההיסטוריה, הפגישות והמשימות שלו יימחקו. אי אפשר לבטל.</p>
                  <div className="row-end">
                    <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
                      לא
                    </button>
                    <button type="button" className="btn danger" onClick={remove}>
                      כן, למחוק
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  מחיקת הליד
                </button>
              )}
            </div>
          )}
        </aside>

        <div className="timeline-col">
          {perms.edit && (
            <div className="panel composer">
              <div className="ctabs" role="tablist" aria-label="פעולה">
                {(
                  [
                    ["wa", "וואטסאפ", "wa"],
                    ["call", "תיעוד שיחה", "phone"],
                    ["note", "הערה", "note"],
                    ["task", "משימה", "check"],
                  ] as const
                ).map(([k, label, icon]) => (
                  <button key={k} type="button" role="tab" className={tab === k ? "on" : ""} aria-selected={tab === k} onClick={() => setTab(k)}>
                    <Icon name={icon} />
                    {label}
                  </button>
                ))}
              </div>
              {tab === "wa" && <WaComposer lead={sl} onSent={(t) => runner(logWhatsAppAction(lead.id, t))} />}
              {tab === "call" && (
                <div className="cpane">
                  <div className="sheet-body">
                    <p className="q">מה קרה בשיחה עם {fn}?</p>
                    <button type="button" className="bigbtn call" onClick={() => sheets.afterCall(sl)}>
                      <Icon name="phone" />
                      לתעד את השיחה
                    </button>
                  </div>
                </div>
              )}
              {tab === "note" && <NoteComposer onSave={(t) => runner(addNoteAction(lead.id, t))} />}
              {tab === "task" && <TaskComposer leadId={lead.id} people={people} canAssign={perms.assignTasks} meId={meId} defaultUser={lead.ownerId ?? meId} onDone={() => toast("המשימה נוספה")} />}
            </div>
          )}
          <ol className="timeline">
            {lead.activities.map((e) => (
              <li key={e.id} className={"ev " + (e.kind === "wa" ? "wa" : e.kind === "miss" ? "miss" : e.kind === "status" || e.kind === "meeting" ? e.kind : "")}>
                <span className="ev-ic">
                  <Icon name={EV_ICON[e.kind] ?? "note"} />
                </span>
                {e.kind === "wa" ? <div className={"bubble " + (e.direction === "in" ? "in" : "out")}>{e.text}</div> : <p>{e.text}</p>}
                {e.tags.length > 0 && (
                  <div className="tags" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {e.tags.map((t, i) => (
                      <span key={t} className={"tag" + (i === 0 ? " ok" : "")}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {e.auto && (
                  <p className="auto">
                    <Icon name="zap" />
                    {e.auto}
                  </p>
                )}
                <time suppressHydrationWarning>
                  {relTime(new Date(e.createdAt))}
                  {e.userName ? `, ${e.userName}` : ""}
                </time>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function MeetingRow({ m, lead, canEdit }: { m: MeetingItem; lead: SheetLead; canEdit: boolean }) {
  const runner = useRunner();
  const sheets = useLeadSheets();
  const d = new Date(m.startAt);
  return (
    <div className="mi">
      <div className="mi-top">
        <b>
          {dayLabel(d)}, {fT(d)}
        </b>
        <small>{[m.projectName, m.place].filter(Boolean).join(", ")}</small>
      </div>
      <small className="muted">
        {m.setByName ? `קבע: ${m.setByName}. ` : ""}
        {m.hostName ? `נפגש: ${m.hostName}` : ""}
      </small>
      <div className="mi-acts">
        <div className="mseg" role="group" aria-label="סטטוס הפגישה">
          {(["set", "cancel", "held"] as MeetingStatus[]).map((s) => {
            const on = m.status === s;
            return (
              <button key={s} type="button" className={on ? "on " + MS[s].c : ""} aria-pressed={on} disabled={!canEdit} onClick={() => !on && runner(meetingStatusAction(m.id, s))}>
                <Icon name={MS[s].icon as IconName} />
                {MS[s].l}
              </button>
            );
          })}
        </div>
        {m.status === "set" && (
          <button type="button" className={"cfm" + (m.confirmed ? " on" : "")} aria-pressed={m.confirmed} disabled={!canEdit} onClick={() => runner(confirmMeetingAction(m.id, !m.confirmed))}>
            <Icon name="cc" />
            {m.confirmed ? "הגעה אושרה" : "לאשר הגעה"}
          </button>
        )}
        {canEdit && m.status === "set" && (
          <button type="button" className="link" onClick={() => sheets.book(lead, { meetingId: m.id })}>
            העברה
          </button>
        )}
      </div>
    </div>
  );
}

function Details({ lead, projects, people, perms }: { lead: LeadCardData; projects: { id: string; name: string }[]; people: { id: string; name: string }[]; perms: { edit: boolean; assign: boolean } }) {
  const runner = useRunner();
  const created = new Date(lead.createdAt);
  return (
    <div className="panel">
      <h3>פרטי הליד</h3>
      <dl className="kv">
        <dt>טלפון</dt>
        <dd>
          <span className="ltr">{lead.phone}</span>
        </dd>
        <dt>אימייל</dt>
        <dd>{lead.email ? <span className="ltr">{lead.email}</span> : <span className="muted">לא נמסר</span>}</dd>
        <dt>מקור הגעה</dt>
        <dd>{lead.source}</dd>
        <dt>פרויקט</dt>
        <dd>
          {perms.edit ? (
            <select aria-label="פרויקט" value={lead.projectId} onChange={(e) => runner(updateLeadAction(lead.id, { projectId: e.target.value }))}>
              {!lead.projectId && <option value="">בוחרים פרויקט…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            lead.projectName
          )}
        </dd>
        <dt>סטטוס</dt>
        <dd>
          <StatusPill status={lead.status} />
        </dd>
        <dt>סוכן</dt>
        <dd>
          {perms.assign ? (
            <select aria-label="סוכן מטפל" value={lead.ownerId ?? ""} onChange={(e) => runner(assignLeadAction(lead.id, e.target.value || null))}>
              <option value="">לא שויך</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            (lead.ownerName ?? <span className="muted">לא שויך</span>)
          )}
        </dd>
        <dt>מתי לחזור</dt>
        <dd>
          {perms.edit ? (
            <input type="date" aria-label="מתי לחזור" value={lead.nextAt ? iso(new Date(lead.nextAt)) : ""} onChange={(e) => runner(updateLeadAction(lead.id, { nextAt: e.target.value }))} />
          ) : lead.nextAt ? (
            dayLabel(new Date(lead.nextAt))
          ) : (
            "—"
          )}
        </dd>
        <dt>נוצר</dt>
        <dd>
          {fD(created)}.{created.getFullYear()}, {fT(created)}
        </dd>
        <dt>דיוור</dt>
        <dd>{lead.consent ? "יש אישור לקבל מידע שיווקי" : <span className="muted">אין אישור</span>}</dd>
      </dl>
    </div>
  );
}

function WaComposer({ lead, onSent }: { lead: SheetLead; onSent: (text: string) => void }) {
  const [text, setText] = useState("");
  const msgs = readyMessages(lead);
  return (
    <div className="cpane">
      <p className="window">
        <i />
        ההודעה נפתחת בוואטסאפ שלך, ונרשמת כאן בכרטיס
      </p>
      <div className="tpls">
        {msgs.map(([title, t]) => (
          <button key={title} type="button" className="tpl" onClick={() => setText(t)}>
            {title}
          </button>
        ))}
        <button type="button" className="tpl" onClick={() => setText(`היי ${firstName(lead.name)}, מאשרים את הפגישה? נשמח לראות אותך.`)}>
          בקשת אישור הגעה
        </button>
      </div>
      <textarea rows={3} placeholder={`כתבו הודעה ל${firstName(lead.name)}`} aria-label="הודעת וואטסאפ" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="crow">
        <span />
        {text.trim() ? (
          <a
            className="btn wa"
            href={waLink(lead.phoneRaw, text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              onSent(text.trim());
              setText("");
            }}
          >
            <Icon name="send" />
            לפתוח בוואטסאפ
          </a>
        ) : (
          <button type="button" className="btn wa" disabled>
            <Icon name="send" />
            לפתוח בוואטסאפ
          </button>
        )}
      </div>
    </div>
  );
}

function NoteComposer({ onSave }: { onSave: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  return (
    <div className="cpane">
      <textarea rows={3} placeholder="כתבו הערה" aria-label="הערה" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="crow">
        <span />
        <button
          type="button"
          className="btn primary"
          disabled={!text.trim()}
          onClick={async () => {
            await onSave(text.trim());
            setText("");
          }}
        >
          שמירת הערה
        </button>
      </div>
    </div>
  );
}

function TaskComposer({ leadId, people, canAssign, meId, defaultUser }: { leadId: string; people: { id: string; name: string }[]; canAssign: boolean; meId: string; defaultUser: string; onDone: () => void }) {
  const runner = useRunner();
  const [title, setTitle] = useState("");
  const next = nextWorkday();
  const [day, setDay] = useState(iso(next));
  const [time, setTime] = useState("10:00");
  const [userId, setUserId] = useState(canAssign ? defaultUser : meId);
  const days = [sod(new Date()), ...Array.from({ length: 6 }, (_, i) => addDays(sod(new Date()), i + 1))].filter((d) => d.getDay() !== 6);
  return (
    <div className="cpane">
      <textarea rows={2} placeholder="מה צריך לעשות?" aria-label="משימה" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="frow">
        <label className="fld">
          <span>מתי</span>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={iso(d)} value={iso(d)}>
                {dayLabel(d)}
                {dayLabel(d).includes(" ") ? "" : ` (${fD(d)})`}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>שעה</span>
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {canAssign && (
        <label className="fld">
          <span>למי</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === meId ? " (אני)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="crow">
        <span />
        <button
          type="button"
          className="btn primary"
          disabled={title.trim().length < 2}
          onClick={async () => {
            const r = await runner(addTaskAction({ title, day, time, userId, leadId }));
            if (r.ok) setTitle("");
          }}
        >
          הוספת משימה
        </button>
      </div>
    </div>
  );
}
