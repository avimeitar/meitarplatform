import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { IBar, MonthChart, Owner } from "@/components/reports/ReportParts";
import { fD, MON } from "@/lib/crm/dates";
import { dealsPeople, dealsReport, pct } from "@/lib/crm/reports";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import { DealsFilters } from "./DealsFilters";
import "../reports.css";

export const metadata = { title: "עסקאות סגורות" };
const PAGE = 50;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const dateText = (d: Date) => `${fD(d)}.${String(d.getFullYear()).slice(2)}`;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("reports.view");
  const sp = await searchParams;
  const now = new Date();
  const [projects, people] = await Promise.all([
    prisma.project.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    dealsPeople(now),
  ]);
  // only filters that point at a real project or person; anything else shows everything
  const projectId = projects.find((p) => p.id === one(sp.project))?.id ?? null;
  const ownerId = people.find((p) => p.id === one(sp.agent))?.id ?? null;
  const pageNo = Math.max(0, Math.floor(Number(one(sp.p))) || 0);
  const r = await dealsReport({ projectId, ownerId }, { skip: pageNo * PAGE, take: PAGE }, now);

  const href = (p: number) => {
    const q = new URLSearchParams();
    if (ownerId) q.set("agent", ownerId);
    if (projectId) q.set("project", projectId);
    if (p) q.set("p", String(p));
    const qs = q.toString();
    return (qs ? `/deals?${qs}` : "/deals") + "#list";
  };
  const lastPage = Math.max(0, Math.ceil(r.total / PAGE) - 1);
  if (pageNo > lastPage) redirect(href(lastPage));

  const filtered = !!(projectId || ownerId);
  const person = new Map(people.map((p) => [p.id, p]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const since = r.months[0].start;
  const thisMonth = r.months[r.months.length - 1].deals;
  const none = filtered ? "אין עסקאות שמתאימות לסינון." : "אין עסקאות ב-6 החודשים האחרונים.";

  return (
    <section className="reports">
      <div className="page-head">
        <div>
          <h1>עסקאות סגורות</h1>
          <p className="sub">
            כל ליד שעבר ל״נחתמה עסקה״ מ-1 ב{MON[since.getMonth()]} עד היום, לפי חודש, סוכן, פרויקט ומקור.
          </p>
        </div>
      </div>
      <DealsFilters
        agents={people.map((p) => ({ id: p.id, label: p.name + (p.inactive ? " (לא פעיל)" : "") }))}
        projects={projects.map((p) => ({ id: p.id, label: p.name + (p.active ? "" : " (לא פעיל)") }))}
        agent={ownerId ?? ""}
        project={projectId ?? ""}
      />
      <div className="rp-body">
        <div className="kpis">
          <div className="kpi">
            <span>נחתמו החודש</span>
            <b>{thisMonth}</b>
          </div>
          <div className="kpi">
            <span>ב-6 חודשים</span>
            <b>{r.total}</b>
          </div>
          <div className="kpi">
            <span>ממוצע לחודש</span>
            <b>{(r.total / 6).toFixed(1)}</b>
          </div>
          <div className="kpi">
            <span>מליד לעסקה</span>
            <b>{pct(r.total, r.leads)}</b>
          </div>
        </div>

        <div className="grid-2 rp-first">
          <div className="panel">
            <div className="panel-head">
              <h2>עסקאות שנחתמו בכל חודש</h2>
            </div>
            <MonthChart months={r.months} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>לפי סוכן</h2>
            </div>
            <Bars
              label="עסקאות לפי סוכן"
              empty={none}
              rows={r.byOwner.map((o) => {
                const p = o.key ? person.get(o.key) : undefined;
                return { key: o.key ?? "none", label: <Owner id={o.key} name={p?.name ?? null} inactive={p?.inactive} />, n: o.deals };
              })}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>לפי פרויקט</h2>
            </div>
            <Bars
              label="עסקאות לפי פרויקט"
              empty={none}
              rows={r.byProject.map((x) => ({ key: x.key ?? "none", label: (x.key && projectName.get(x.key)) || <span className="muted">בלי פרויקט</span>, n: x.deals }))}
            />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>לפי מקור הגעה</h2>
            </div>
            <Bars label="עסקאות לפי מקור הגעה" empty={none} rows={r.bySource.map((x) => ({ key: x.key, label: x.key, n: x.deals }))} />
          </div>
        </div>

        <div className="panel flush rp-list rp-deals" id="list">
          <table className="data">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>ליד</th>
                <th>פרויקט</th>
                <th>סוכן</th>
                <th>מקור הגעה</th>
              </tr>
            </thead>
            <tbody>
              {r.list.map((d) => (
                <tr key={d.id}>
                  <td className="c-date">
                    <span className="num">{dateText(d.closedAt)}</span>
                  </td>
                  <td className="c-lead">
                    <Link className="lk" href={`/leads/${d.id}`}>
                      <b>{d.name}</b>
                      <small className="rp-m">{[d.project ?? "בלי פרויקט", d.owner ?? "לא שויך", d.source].join(" · ")}</small>
                    </Link>
                  </td>
                  <td className="c-proj">{d.project ?? <span className="muted">בלי פרויקט</span>}</td>
                  <td className="c-owner">
                    <Owner id={d.ownerId} name={d.owner} />
                  </td>
                  <td className="c-src">{d.source}</td>
                </tr>
              ))}
              {!r.list.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    {none}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {r.total > PAGE && (
          <div className="more-row">
            {pageNo > 0 && (
              <Link className="btn" href={href(pageNo - 1)}>
                חדשות יותר
              </Link>
            )}
            <span className="muted">
              <span className="num">{pageNo * PAGE + 1}</span> עד <span className="num">{Math.min(r.total, (pageNo + 1) * PAGE)}</span> מתוך <span className="num">{r.total}</span>
            </span>
            {pageNo < lastPage && (
              <Link className="btn" href={href(pageNo + 1)}>
                ישנות יותר
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Bars({ rows, label, empty }: { rows: { key: string; label: ReactNode; n: number }[]; label: string; empty: string }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <table className="mini rp-bars" aria-label={label}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>
              <IBar n={r.n} max={max} width={120} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
