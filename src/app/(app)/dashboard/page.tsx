import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Agenda } from "@/components/crm/Agenda";
import { AssignButtons, AutoAssignAll } from "@/components/crm/AssignButtons";
import { LeadLink, nOf, Owner, StatusPill } from "@/components/crm/bits";
import { TaskList } from "@/components/crm/TaskList";
import { dayLabel, MON, relTime, WD } from "@/lib/crm/dates";
import { agentHome, managerDashboard } from "@/lib/crm/views";
import { can, requirePageUser } from "@/lib/session";

export const metadata = { title: "ראשי" };

function greet(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}

function today(now = new Date()) {
  return `${WD[now.getDay()]}, ${now.getDate()} ב${MON[now.getMonth()]}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  if (!can(u, "reports.view")) return <AgentHome />;
  const sp = await searchParams;
  const days = [1, 7, 30, 90].includes(Number(sp.d)) ? Number(sp.d) : 7;
  return <ManagerHome days={days} />;
}

async function AgentHome() {
  const u = await requirePageUser();
  const d = await agentHome(u);
  const q = d.queue;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>
            {greet()}, {u.firstName}
          </h1>
          <p className="sub">{today()}</p>
        </div>
      </div>
      <div className="hero-work">
        <div>
          <h2>{q.length ? nOf(q.length, "ליד אחד מחכה לך", "לידים מחכים לך") : "אין לידים שמחכים לך עכשיו"}</h2>
          <p>מטפלים בליד אחד בכל פעם, לפי הסדר שהמערכת קובעת.</p>
          <div className="today-stats">
            <span>
              <b>{d.calls}</b> שיחות היום
            </span>
            <span>
              <b>{d.meets}</b> פגישות נקבעו היום
            </span>
          </div>
        </div>
        {q.length > 0 && (
          <Link className="bigbtn" href="/work">
            <Icon name="phone" />
            להתחיל לעבוד
          </Link>
        )}
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2>הבאים בתור</h2>
            {q.length > 0 && (
              <Link className="link" href="/work">
                לתור השיחות
              </Link>
            )}
          </div>
          {q.length ? (
            <ul className="qlist">
              {q.slice(0, 5).map((x) => (
                <li key={x.leadId}>
                  <LeadLink id={x.leadId} name={x.name} sub={x.why} />
                  <StatusPill status={x.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">הכול מטופל. לידים חדשים יופיעו כאן.</p>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>הפגישות שלי</h2>
            <Link className="link" href="/meetings">
              ליומן
            </Link>
          </div>
          <Agenda items={d.meetings} />
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>המשימות שלי</h2>
          <Link className="link" href="/tasks">
            לכל המשימות
          </Link>
        </div>
        <TaskList tasks={d.tasks} empty="אין משימות פתוחות." />
      </div>
    </section>
  );
}

async function ManagerHome({ days }: { days: number }) {
  const u = await requirePageUser("reports.view");
  const d = await managerDashboard(days);
  const unassigned = d.overnight.filter((l) => !l.ownerId);
  const canAssign = can(u, "leads.assign");
  const night = new Date(d.nightStart);
  const F = ["לידים", "נוצר קשר", "נקבעה פגישה", "התקיימה פגישה", "נחתמה עסקה"];
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "0%");
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>
            {greet()}, {u.firstName}
          </h1>
          <p className="sub">
            {today()}. {d.overnight.length === 1 ? "ליד אחד נכנס" : `${d.overnight.length} לידים נכנסו`} מאז {dayLabel(night)} ב-19:00.
          </p>
        </div>
      </div>
      <div className="alerts-row">
        {unassigned.length > 0 && (
          <a className="achip red" href="#night">
            <Icon name="users" />
            {unassigned.length === 1 ? "ליד חדש אחד עוד לא שויך" : `${unassigned.length} לידים חדשים עוד לא שויכו`}
          </a>
        )}
        {d.stale > 0 && (
          <Link className="achip amber" href="/meetings?range=stale">
            <Icon name="alert" />
            {d.stale === 1 ? "פגישה אחת עברה ועוד לא סומן מה קרה בה" : `${d.stale} פגישות עברו ועוד לא סומן מה קרה בהן`}
          </Link>
        )}
        {d.overdue > 0 && (
          <Link className="achip amber" href="/tasks?f=late">
            <Icon name="clock" />
            {nOf(d.overdue, "משימה אחת באיחור", "משימות באיחור")}
          </Link>
        )}
        {!unassigned.length && !d.stale && !d.overdue && (
          <span className="achip ok">
            <Icon name="cc" />
            אין משהו דחוף
          </span>
        )}
      </div>
      <div className="grid-2 wide" style={{ marginTop: 0 }}>
        <div className="panel" id="night">
          <div className="panel-head">
            <h2>לידים חדשים</h2>
            <span className="muted">מאז {dayLabel(night)} 19:00</span>
          </div>
          {d.overnight.length ? (
            <ul className="nightlist">
              {d.overnight.map((l) => (
                <li key={l.id}>
                  <LeadLink id={l.id} name={l.name} sub={[l.projectName, l.source].filter(Boolean).join(", ")} />
                  <time>{relTime(new Date(l.createdAt))}</time>
                  {l.ownerId || !canAssign ? <Owner name={l.ownerName} /> : <AssignButtons leadId={l.id} people={d.people} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">לא נכנסו לידים חדשים.</p>
          )}
          {canAssign && <AutoAssignAll leadIds={unassigned.map((l) => l.id)} />}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>פגישות היום וביום העבודה הבא</h2>
            <Link className="link" href="/meetings">
              לכל הפגישות
            </Link>
          </div>
          <Agenda items={d.agenda} />
        </div>
      </div>
      <div className="panel funnel">
        <div className="panel-head">
          <h2>המסלול {days === 1 ? "היום" : `ב-${days} הימים האחרונים`}</h2>
          <div className="seg" role="group" aria-label="תקופה">
            {[
              [1, "היום"],
              [7, "7 ימים"],
              [30, "30 יום"],
              [90, "90 יום"],
            ].map(([v, l]) => (
              <Link key={v} className={v === days ? "on" : ""} href={`/dashboard?d=${v}`}>
                {l}
              </Link>
            ))}
          </div>
        </div>
        <ol className="metro big" aria-label="משפך לידים">
          {d.funnel.map((n, i) => (
            <li key={F[i]}>
              <b className="n">{n}</b>
              <span className="dot" />
              <span className="lbl">{F[i]}</span>
              {i > 0 && <em className="rate">{rate(n, d.funnel[i - 1])}</em>}
            </li>
          ))}
        </ol>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>משימות הצוות</h2>
          <Link className="link" href="/tasks">
            לכל המשימות
          </Link>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="mini">
            <thead>
              <tr>
                <th>שם</th>
                <th>פתוחות</th>
                <th>באיחור</th>
                <th>להיום</th>
                <th>בוצעו השבוע</th>
              </tr>
            </thead>
            <tbody>
              {d.taskStats.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tasks?user=${t.id}`} className="owner-link">
                      <Owner name={t.name} />
                    </Link>
                  </td>
                  <td>{t.open}</td>
                  <td className={t.late ? "late" : ""}>{t.late}</td>
                  <td>{t.dueToday}</td>
                  <td>{t.doneWeek}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
