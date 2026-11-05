import Link from "next/link";
import type { CSSProperties } from "react";
import { IBar, Owner } from "@/components/reports/ReportParts";
import { ST, ST_ORDER, type LeadStatus } from "@/lib/crm/constants";
import { MON } from "@/lib/crm/dates";
import { pct, projectBreakdown, projectSummaries, type BreakdownRow, type ProjectSummary } from "@/lib/crm/reports";
import { prisma } from "@/lib/db";
import { can, requirePageUser } from "@/lib/session";
import { EditProjectButton, NewProjectButton, ReactivateProjectButton } from "./ProjectManage";
import "../reports.css";

export const metadata = { title: "פרויקטים" };

/** How the overview bars group the statuses, as in the approved design. "לא רלוונטי" is left out. */
const GROUPS: { label: string; color: string; statuses: LeadStatus[] }[] = [
  { label: "פתוחים", color: "var(--c1)", statuses: ["new", "process", "noans"] },
  { label: "בפגישות", color: "var(--c2)", statuses: ["meet", "resched", "held"] },
  { label: "המשך טיפול", color: "var(--c3)", statuses: ["follow"] },
  { label: "נחתמו", color: "var(--c4)", statuses: ["won"] },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const sum = (p: ProjectSummary, statuses: LeadStatus[]) => statuses.reduce((s, k) => s + p.byStatus[k], 0);
const activeLeads = (p: ProjectSummary) => p.leads - p.byStatus.lost;
/** Selecting an open project closes it again. */
const toggleHref = (id: string, open: boolean) => (open ? "/projects" : `/projects?project=${encodeURIComponent(id)}#detail`);

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePageUser("reports.view");
  const manage = can(me, "projects.manage");
  const wanted = one((await searchParams).project);
  const now = new Date();
  const [rows, breakdown, inactive] = await Promise.all([
    projectSummaries(now),
    wanted ? projectBreakdown(wanted, now) : null,
    manage ? prisma.project.findMany({ where: { active: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, fullName: true, place: true } }) : [],
  ]);
  const selected = rows.find((r) => r.id === wanted) ?? null;
  const max = Math.max(1, ...rows.map(activeLeads));

  return (
    <section className="reports">
      <div className="page-head">
        <div>
          <h1>פרויקטים</h1>
          <p className="sub">מה המצב בכל פרויקט: לידים, פגישות ועסקאות.</p>
        </div>
        {manage && (
          <div className="head-actions">
            <NewProjectButton />
          </div>
        )}
      </div>

      {!rows.length ? (
        <div className="panel">
          <p className="empty">אין פרויקטים פעילים.{manage ? " אפשר להוסיף פרויקט בכפתור ״פרויקט חדש״." : ""}</p>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h2>לידים פעילים לפי פרויקט</h2>
              <span className="muted">לא כולל ״לא רלוונטי״</span>
            </div>
            <div className="legend" aria-hidden="true">
              {GROUPS.map((g) => (
                <span key={g.label}>
                  <i style={{ "--c": g.color } as CSSProperties} />
                  {g.label}
                </span>
              ))}
            </div>
            <div className="srows">
              {rows.map((r) => {
                const open = r.id === selected?.id;
                const groups = GROUPS.map((g) => ({ ...g, n: sum(r, g.statuses) }));
                const detail = (g: (typeof groups)[number]) => `${g.label}: ${g.n}` + (g.statuses.length > 1 ? ` (${g.statuses.map((s) => `${ST[s].l} ${r.byStatus[s]}`).join(", ")})` : "");
                return (
                  <div className="srow" key={r.id}>
                    <Link className={"srow-name" + (open ? " on" : "")} href={toggleHref(r.id, open)} aria-current={open ? "true" : undefined}>
                      {r.name}
                    </Link>
                    <div className="sbar" style={{ width: Math.max(2, Math.round((activeLeads(r) / max) * 100)) + "%" }} role="img" aria-label={`${r.name}. ${groups.map(detail).join(". ")}`}>
                      {groups.map((g) => (g.n ? <i key={g.label} style={{ "--c": g.color, flex: g.n } as CSSProperties} title={`${r.name}, ${detail(g)}`} /> : null))}
                    </div>
                    <span className="srow-n">
                      <b>{activeLeads(r)}</b> פעילים, <span className="num">{r.byStatus.lost}</span> לא רלוונטי
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="rp-note">
            החודש: מ-1 ב{MON[now.getMonth()]} · פגישות: שהתקיימו ב-30 הימים האחרונים · המרה: עסקאות מתוך כל הלידים
          </p>
          <div className="pcards">
            {rows.map((r) => {
              const open = r.id === selected?.id;
              return (
                <Link key={r.id} className={"pcard" + (open ? " on" : "")} href={toggleHref(r.id, open)} aria-current={open ? "true" : undefined}>
                  <h3>{r.fullName}</h3>
                  <span className="place">{r.place}</span>
                  <div className="pstats">
                    <div>
                      <b>{r.leads}</b>
                      <span>לידים</span>
                    </div>
                    <div>
                      <b>{r.newThisMonth}</b>
                      <span>חדשים החודש</span>
                    </div>
                    <div>
                      <b>{r.meetingsHeld}</b>
                      <span>פגישות שהתקיימו</span>
                    </div>
                    <div>
                      <b>{r.dealsThisMonth}</b>
                      <span>עסקאות החודש</span>
                    </div>
                    <div>
                      <b>{r.deals}</b>
                      <span>עסקאות</span>
                    </div>
                    <div>
                      <b>{pct(r.deals, r.leads)}</b>
                      <span>המרה</span>
                    </div>
                  </div>
                  <div className="pfoot">
                    <span>{r.topSource ? `מקור מוביל: ${r.topSource}` : "אין עדיין לידים"}</span>
                    <span className="link">{open ? "סגירה" : "פירוט"}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          {selected && breakdown && <ProjectDetail p={selected} breakdown={breakdown} manage={manage} />}
        </>
      )}

      {manage && inactive.length > 0 && (
        <>
          <h2 className="sec-h">פרויקטים לא פעילים</h2>
          <div className="panel">
            <p className="muted rp-plist-note">לא מופיעים בבחירת פרויקט לליד חדש ובדוח הזה. הלידים והעסקאות שלהם נשמרים.</p>
            <ul className="rp-plist">
              {inactive.map((p) => (
                <li key={p.id}>
                  <div>
                    <b>{p.fullName}</b>
                    <small>{p.place}</small>
                  </div>
                  <ReactivateProjectButton project={p} />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function ProjectDetail({ p, breakdown, manage }: { p: ProjectSummary; breakdown: { byOwner: BreakdownRow[]; bySource: BreakdownRow[] }; manage: boolean }) {
  const maxStatus = Math.max(1, ...ST_ORDER.map((s) => p.byStatus[s]));
  return (
    <section id="detail" className="rp-detail" aria-labelledby="rp-detail-h">
      <div className="rp-detail-head">
        <div>
          <h2 id="rp-detail-h">{p.fullName}</h2>
          <p className="muted">
            {p.place} ·{" "}
            {p.leads === 1 ? (
              "ליד אחד"
            ) : (
              <>
                <span className="num">{p.leads}</span> לידים
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn" href={`/leads?view=all&project=${encodeURIComponent(p.id)}`}>
            ללידים של הפרויקט
          </Link>
          {manage && <EditProjectButton project={{ id: p.id, name: p.name, fullName: p.fullName, place: p.place }} />}
          <Link className="btn ghost" href="/projects" scroll={false}>
            סגירה
          </Link>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3>לפי סוכן</h3>
            <span className="muted">לפי מי שהליד משויך אליו</span>
          </div>
          <Breakdown first="סוכן" rows={breakdown.byOwner} people />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>לפי מקור הגעה</h3>
          </div>
          <Breakdown first="מקור" rows={breakdown.bySource} />
        </div>
      </div>
      <div className="panel rp-status">
        <div className="panel-head">
          <h3>לפי סטטוס</h3>
        </div>
        <ul className="rp-st">
          {ST_ORDER.map((s) => (
            <li key={s}>
              <span className={"st-pill " + ST[s].c}>{ST[s].l}</span>
              <IBar n={p.byStatus[s]} max={maxStatus} width={120} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Breakdown({ first, rows, people }: { first: string; rows: BreakdownRow[]; people?: boolean }) {
  if (!rows.length) return <p className="empty">אין עדיין לידים בפרויקט.</p>;
  return (
    <div className="rp-scroll">
      <table className="mini rp-break">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">לידים</th>
            <th scope="col">חדשים החודש</th>
            <th scope="col">פגישות שהתקיימו</th>
            <th scope="col">עסקאות</th>
            <th scope="col">המרה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key ?? "none"}>
              <td className="rp-name">{people ? <Owner id={r.key} name={r.key ? r.label : null} inactive={r.inactive} /> : r.label}</td>
              <td className="num" data-label="לידים">
                {r.leads}
              </td>
              <td className="num" data-label="חדשים החודש">
                {r.newThisMonth}
              </td>
              <td className="num" data-label="פגישות שהתקיימו">
                {r.meetingsHeld}
              </td>
              <td className="num" data-label="עסקאות">
                {r.deals}
              </td>
              <td className="num" data-label="המרה">
                {pct(r.deals, r.leads)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
