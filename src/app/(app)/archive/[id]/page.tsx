import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ARCHIVE_KINDS, type ArchiveKind } from "@/lib/archive";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { requirePageUser } from "@/lib/session";
import { day, dayTime, statusText } from "../labels";

export const metadata = { title: "ארכיון" };

type Meeting = { startAt: string | null; client?: string | null; subject: string | null; source: string | null; project: string | null; place: string; status: string; confirmed: boolean; setBy: string | null; host: string | null; note: string | null };
type Task = { title: string; dueAt: string | null; state: string; doneAt: string | null; user: string | null };
type LeadData = {
  email: string | null;
  source: string;
  lostReason: string | null;
  attempts: number;
  consent: boolean;
  createdBy: string | null;
  activities: { at: string; kind: string; text: string; by: string | null; auto: string | null }[];
  inquiries: { at: string; source: string; project: string | null; campaign: string | null; page: string | null }[];
  meetings: Meeting[];
  tasks: Task[];
  assignments: { at: string; to: string | null; by: string | null }[];
};

/** One archived record, as it was on the day it moved. Read only. */
export default async function ArchiveRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser("archive.manage");
  const { id } = await params;
  const r = await prisma.archiveRecord.findUnique({ where: { id }, include: { batch: { select: { createdAt: true, byName: true } } } });
  if (!r) notFound();
  const kind = r.kind as ArchiveKind;
  const kindLabel = ARCHIVE_KINDS.find((k) => k.key === kind)?.label ?? "";
  // a client's meeting or task leads back to the client, moved in the same batch
  const clientId = (r.data as { clientId?: string | null } | null)?.clientId;
  const client = clientId && kind !== "lead" ? await prisma.archiveRecord.findFirst({ where: { batchId: r.batchId, kind: "lead", originalId: clientId }, select: { id: true, name: true } }) : null;

  return (
    <section className="archive ar-card">
      <Link className="back" href={`/archive?kind=${kind}`}>
        <Icon name="back" />
        לארכיון: {kindLabel}
      </Link>
      <div className="page-head">
        <div>
          <h1>{r.name}</h1>
          <p className="sub">
            בארכיון מ-{day(r.batch.createdAt)}, העביר {r.batch.byName}. כך זה היה ביום ההעברה, לקריאה בלבד.
          </p>
        </div>
        {client && (
          <div className="head-actions">
            <Link className="btn ghost" href={`/archive/${client.id}`}>
              <Icon name="users" />
              לכרטיס של {client.name}
            </Link>
          </div>
        )}
      </div>
      {kind === "lead" ? <LeadView r={r} d={r.data as unknown as LeadData} /> : kind === "meeting" ? <MeetingView m={r.data as unknown as Meeting} title="פרטי הפגישה" /> : kind === "task" ? <TaskView t={r.data as unknown as Task} /> : <ProjectView d={r.data as Record<string, unknown>} />}
    </section>
  );
}

type Rec = { name: string; phone: string | null; project: string | null; status: string | null; owner: string | null; at: Date };

function LeadView({ r, d }: { r: Rec; d: LeadData }) {
  return (
    <div className="mc-grid">
      <div>
        <div className="panel">
          <div className="panel-head">
            <h2>מה קרה עם הלקוח</h2>
          </div>
          {d.activities?.length ? (
            <ol className="mc-hist">
              {[...d.activities].reverse().map((a, i) => (
                <li key={i}>
                  {a.text}
                  <time>
                    {dayTime(a.at)}
                    {a.by ? `, ${a.by}` : ""}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">אין היסטוריה.</p>
          )}
        </div>
        {d.meetings?.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>פגישות</h2>
            </div>
            {d.meetings.map((m, i) => (
              <MeetingView key={i} m={m} flat />
            ))}
          </div>
        )}
        {d.tasks?.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>משימות</h2>
            </div>
            <ul className="ar-mini">
              {d.tasks.map((t, i) => (
                <li key={i}>
                  <b>{t.title}</b>
                  <span>
                    {statusText("task", t.state)} · עד {dayTime(t.dueAt)}
                    {t.user ? ` · ${t.user}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div>
        <div className="panel">
          <div className="panel-head">
            <h2>פרטי הלקוח</h2>
          </div>
          <dl className="kv">
            <dt>טלפון</dt>
            <dd className="ltr">{r.phone ? formatPhone(r.phone) : ""}</dd>
            {d.email && (
              <>
                <dt>אימייל</dt>
                <dd className="ltr">{d.email}</dd>
              </>
            )}
            <dt>מקור הגעה</dt>
            <dd>{d.source}</dd>
            <dt>פרויקט</dt>
            <dd>{r.project ?? <span className="muted">לא צוין</span>}</dd>
            <dt>סטטוס</dt>
            <dd>
              {statusText("lead", r.status)}
              {d.lostReason ? `, ${d.lostReason}` : ""}
            </dd>
            <dt>מנהל לקוח</dt>
            <dd>{r.owner ?? <span className="muted">לא שויך</span>}</dd>
            <dt>נכנס</dt>
            <dd>{dayTime(r.at)}</dd>
            <dt>אישור דיוור</dt>
            <dd>{d.consent ? "כן" : "לא"}</dd>
          </dl>
        </div>
        {d.inquiries?.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>פניות</h2>
            </div>
            <ul className="ar-mini">
              {d.inquiries.map((q, i) => (
                <li key={i}>
                  <b>{q.source}</b>
                  <span>
                    {dayTime(q.at)}
                    {q.project ? ` · ${q.project}` : ""}
                    {q.campaign ? ` · ${q.campaign}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.assignments?.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>שיוכים</h2>
            </div>
            <ul className="ar-mini">
              {d.assignments.map((a, i) => (
                <li key={i}>
                  <b>{a.to ?? "לא ידוע"}</b>
                  <span>
                    {dayTime(a.at)}
                    {a.by ? ` · שייך ${a.by}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingView({ m, title, flat }: { m: Meeting; title?: string; flat?: boolean }) {
  const body = (
    <dl className="kv ar-meeting">
      <dt>מתי</dt>
      <dd>{dayTime(m.startAt)}</dd>
      <dt>סטטוס</dt>
      <dd>{statusText("meeting", m.status, m.confirmed)}</dd>
      {m.client && (
        <>
          <dt>עם</dt>
          <dd>{m.client}</dd>
        </>
      )}
      {(m.project || m.subject) && (
        <>
          <dt>{m.project ? "פרויקט" : "נושא"}</dt>
          <dd>{m.project || m.subject}</dd>
        </>
      )}
      <dt>איפה</dt>
      <dd>{m.place}</dd>
      <dt>נקבעה ע״י</dt>
      <dd>{m.setBy ?? <span className="muted">לא ידוע</span>}</dd>
      <dt>נפגשים עם</dt>
      <dd>{m.host ?? <span className="muted">לא נקבע</span>}</dd>
      {m.note && (
        <>
          <dt>תיאור</dt>
          <dd style={{ whiteSpace: "pre-wrap" }}>{m.note}</dd>
        </>
      )}
    </dl>
  );
  if (flat) return body;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {body}
    </div>
  );
}

function TaskView({ t }: { t: Task }) {
  return (
    <div className="panel">
      <dl className="kv">
        <dt>משימה</dt>
        <dd>{t.title}</dd>
        <dt>סטטוס</dt>
        <dd>{statusText("task", t.state)}</dd>
        <dt>עד מתי</dt>
        <dd>{dayTime(t.dueAt)}</dd>
        <dt>של מי</dt>
        <dd>{t.user ?? ""}</dd>
        {t.doneAt && (
          <>
            <dt>בוצעה</dt>
            <dd>{dayTime(t.doneAt)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function ProjectView({ d }: { d: Record<string, unknown> }) {
  return (
    <div className="panel">
      <dl className="kv">
        <dt>שם מלא</dt>
        <dd>{String(d.fullName ?? "")}</dd>
        {d.place ? (
          <>
            <dt>מקום</dt>
            <dd>{String(d.place)}</dd>
          </>
        ) : null}
        <dt>מצב</dt>
        <dd>{d.active ? "היה פעיל" : "היה סגור"}</dd>
      </dl>
    </div>
  );
}
