import Link from "next/link";
import { Icon } from "@/components/Icon";
import { AutoSubmitForm } from "@/components/ui/AutoSubmitForm";
import { ARCHIVE_KINDS, likelyKept } from "@/lib/archive";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { requirePageUser } from "@/lib/session";
import { ArchiveRun } from "./ArchiveRun";
import { day, dayTime, statusText } from "./labels";
import { archiveQuery, type ArchiveParams } from "./query";

export const metadata = { title: "ארכיון" };

const PAGE = 50;
type Counts = { leads?: number; meetings?: number; tasks?: number; projects?: number };

/** What moved to the archive, read only. System administrators only. */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<ArchiveParams> }) {
  await requirePageUser("archive.manage");
  const sp = await searchParams;
  const { kind, q, project, where } = archiveQuery(sp);
  const page = Math.max(0, Math.floor(Number(sp.p)) || 0);
  const [rows, total, byKind, projectNames, batches, projects] = await Promise.all([
    prisma.archiveRecord.findMany({ where, orderBy: { at: "desc" }, skip: page * PAGE, take: PAGE, select: { id: true, name: true, phone: true, project: true, status: true, owner: true, at: true, data: true } }),
    prisma.archiveRecord.count({ where }),
    prisma.archiveRecord.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.archiveRecord.groupBy({ by: ["project"], where: { project: { not: null } }, orderBy: { project: "asc" } }),
    prisma.archiveBatch.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.project.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  const kindCount = (k: string) => byKind.find((x) => x.kind === k)?._count._all ?? 0;
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ kind, q: q || undefined, project: project || undefined, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/archive?${p}`;
  };
  const exportHref = `/api/export/archive?${new URLSearchParams(Object.entries({ kind, q, project }).filter(([, v]) => v) as [string, string][])}`;
  const pages = Math.ceil(total / PAGE);

  return (
    <section className="archive">
      <div className="page-head">
        <div>
          <h1>ארכיון</h1>
          <p className="sub">לקוחות, פגישות, משימות ופרויקטים שהועברו לארכיון, כמו שהיו ביום ההעברה, עם כל ההיסטוריה. רק מנהלי מערכת רואים את המסך הזה.</p>
        </div>
        <div className="head-actions">
          {/* a plain link: the file downloads, and can go straight into a Google Drive folder */}
          <a className="btn ghost" href="/api/backup" download>
            <Icon name="lock" />
            הורדת גיבוי מלא
          </a>
          {total > 0 && (
            <a className="btn ghost" href={exportHref}>
              <Icon name="upload" />
              ייצוא לאקסל
            </a>
          )}
          <ArchiveRun projects={projects.map((p) => ({ id: p.id, name: p.name, active: p.active, suggested: likelyKept(p.name) }))} />
        </div>
      </div>

      {batches.length > 0 && (
        <div className="panel ar-batches">
          <h2>העברות לארכיון</h2>
          <ul>
            {batches.map((b) => {
              const c = (b.counts ?? {}) as Counts;
              return (
                <li key={b.id}>
                  <b>{dayTime(b.createdAt)}</b>
                  <span>{b.byName}</span>
                  <span>
                    {c.leads ?? 0} לקוחות · {c.meetings ?? 0} פגישות · {c.tasks ?? 0} משימות · {c.projects ?? 0} פרויקטים
                  </span>
                  <small className="muted">{b.kept.length ? `נשארו במערכת: ${b.kept.join(", ")}` : "לא נשאר אף פרויקט"}</small>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="views" role="group" aria-label="מה בארכיון">
        {ARCHIVE_KINDS.map((k) => (
          <Link key={k.key} className={"view" + (k.key === kind ? " on" : "")} href={`/archive?kind=${k.key}`} aria-current={k.key === kind ? "page" : undefined}>
            {k.label} <b>{kindCount(k.key)}</b>
          </Link>
        ))}
      </div>
      <AutoSubmitForm className="toolbar ar-tools" action="/archive" role="search">
        <input type="hidden" name="kind" value={kind} />
        <label className="search ar-search">
          <Icon name="search" />
          <span className="sr">חיפוש בארכיון</span>
          <input type="search" name="q" defaultValue={q} placeholder={kind === "lead" ? "חיפוש לפי שם או טלפון" : "חיפוש לפי שם"} />
        </label>
        {kind !== "project" && projectNames.length > 0 && (
          <label className="sel">
            <span className="sr">פרויקט</span>
            <select name="project" defaultValue={project}>
              <option value="">כל הפרויקטים</option>
              {projectNames.map((p) => (
                <option key={p.project} value={p.project ?? ""}>
                  {p.project}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn sm">
          חיפוש
        </button>
        {(q || project) && (
          <Link className="filter on" href={`/archive?kind=${kind}`}>
            ניקוי <Icon name="x" />
          </Link>
        )}
      </AutoSubmitForm>

      {rows.length ? (
        <div className="panel flush">
          <table className="data ar-table">
            <thead>
              <tr>
                <th>{kind === "task" ? "משימה" : kind === "project" ? "פרויקט" : "שם"}</th>
                {kind === "lead" && <th>טלפון</th>}
                {kind !== "project" && <th>פרויקט</th>}
                <th>סטטוס</th>
                {kind !== "project" && <th>{kind === "lead" ? "מנהל לקוח" : kind === "task" ? "של מי" : "נפגשים עם"}</th>}
                <th>{kind === "meeting" ? "מועד" : kind === "task" ? "עד מתי" : "נוצר"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="lk" href={`/archive/${r.id}`}>
                      {r.name}
                    </Link>
                  </td>
                  {kind === "lead" && (
                    <td data-label="טלפון">
                      <span className="ltr">{r.phone ? formatPhone(r.phone) : ""}</span>
                    </td>
                  )}
                  {kind !== "project" && <td data-label="פרויקט">{r.project ?? ""}</td>}
                  <td data-label="סטטוס">{statusText(kind, r.status, !!(r.data as { confirmed?: boolean } | null)?.confirmed)}</td>
                  {kind !== "project" && <td data-label="אחראי">{r.owner ?? ""}</td>}
                  <td data-label="תאריך" className="num">
                    {kind === "meeting" ? dayTime(r.at) : day(r.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <p className="empty">
            {kindCount(kind) === 0 && !q && !project
              ? "עוד אין כאן כלום. ״העברה לארכיון״ מעבירה לכאן את כל הלקוחות, הפגישות והמשימות, עם כל ההיסטוריה שלהם."
              : "לא נמצא כלום בחיפוש הזה."}
          </p>
        </div>
      )}
      {pages > 1 && (
        <div className="more-row ar-pages">
          {page > 0 && (
            <Link className="btn sm" href={href({ p: String(page - 1) })}>
              הקודמים
            </Link>
          )}
          <span className="muted">
            עמוד {page + 1} מתוך {pages} · {total} בסך הכול
          </span>
          {page < pages - 1 && (
            <Link className="btn sm" href={href({ p: String(page + 1) })}>
              הבאים
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
