import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { ST, ST_ORDER, OPEN_STATUSES, MANUAL_SOURCES, isLeadStatus } from "@/lib/crm/constants";
import { addDays, sod } from "@/lib/crm/dates";
import { leadScope } from "@/lib/crm/views";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, requirePageUser, type CurrentUser } from "@/lib/session";
import { LeadsTable, type LeadRow } from "./LeadsTable";

export const metadata = { title: "לידים" };

type View = { key: string; label: string; where: (u: CurrentUser) => Prisma.LeadWhereInput };

const VIEWS: Record<string, View> = {
  today: { key: "today", label: "לטפל היום", where: (u) => ({ ownerId: u.id, OR: [{ status: "new" }, { status: { in: OPEN_STATUSES.filter((s) => s !== "new" && s !== "meet") }, nextAt: { lt: addDays(sod(new Date()), 1) } }] }) },
  mine: { key: "mine", label: "הלידים שלי", where: (u) => ({ ownerId: u.id }) },
  all: { key: "all", label: "כל הלידים", where: () => ({}) },
  new: { key: "new", label: "חדשים", where: () => ({ status: "new" }) },
  unassigned: { key: "unassigned", label: "לא שויכו", where: () => ({ ownerId: null }) },
  noans: { key: "noans", label: "אין מענה", where: () => ({ status: "noans" }) },
  meet: { key: "meet", label: "נקבעה פגישה", where: () => ({ status: "meet" }) },
  resched: { key: "resched", label: "לתאם מחדש", where: () => ({ status: "resched" }) },
  follow: { key: "follow", label: "אחרי פגישה", where: () => ({ status: { in: ["held", "follow"] } }) },
  won: { key: "won", label: "נחתמו", where: () => ({ status: "won" }) },
  lost: { key: "lost", label: "לא רלוונטי", where: () => ({ status: "lost" }) },
};
const AGENT_VIEWS = ["today", "mine", "new", "resched", "all"];
const MANAGER_VIEWS = ["all", "new", "unassigned", "noans", "meet", "resched", "follow", "won", "lost"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const manager = can(u, "leads.assign");
  const viewKeys = (manager ? MANAGER_VIEWS : AGENT_VIEWS).filter((k) => k !== "all" || can(u, "leads.view_all"));
  const view = VIEWS[sp.view ?? ""] && viewKeys.includes(sp.view ?? "") ? VIEWS[sp.view as string] : VIEWS[manager ? "all" : "mine"];
  const q = (sp.q ?? "").trim().slice(0, 60);
  const limit = Math.min(500, Math.max(50, Number(sp.limit) || 50));
  const filters: Prisma.LeadWhereInput[] = [];
  if (sp.project) filters.push({ projectId: sp.project });
  if (sp.source) filters.push({ source: sp.source });
  if (sp.status && isLeadStatus(sp.status)) filters.push({ status: sp.status });
  if (sp.owner && manager) filters.push(sp.owner === "none" ? { ownerId: null } : { ownerId: sp.owner });
  const scope = leadScope(u);

  let where: Prisma.LeadWhereInput;
  if (q) {
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    where = { AND: [scope, { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }] };
  } else where = { AND: [scope, view.where(u), ...filters] };

  const orderBy: Prisma.LeadOrderByWithRelationInput[] = ["today", "noans", "resched", "follow"].includes(view.key) && !q ? [{ nextAt: "asc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }];
  const [rows, total, counts, projects, people] = await Promise.all([
    prisma.lead.findMany({ where, orderBy, take: limit, include: { project: { select: { name: true } }, owner: { select: { name: true } } } }),
    prisma.lead.count({ where }),
    Promise.all(viewKeys.map((k) => prisma.lead.count({ where: { AND: [scope, VIEWS[k].where(u), ...filters] } }))),
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const data: LeadRow[] = rows.map((l) => ({
    id: l.id,
    name: l.name,
    phone: formatPhone(l.phone),
    phoneRaw: l.phone,
    email: l.email ?? "",
    source: l.source,
    projectName: l.project?.name ?? "",
    status: l.status,
    lostReason: l.lostReason,
    ownerName: l.owner?.name ?? null,
    nextAt: l.nextAt && l.status !== "won" && l.status !== "lost" ? l.nextAt.toISOString() : null,
  }));

  const keep = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: view.key, project: sp.project, source: sp.source, status: sp.status, owner: sp.owner, filters: sp.filters, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/leads?${p.toString()}`;
  };
  const fcount = [sp.project, sp.source, sp.status, manager ? sp.owner : undefined].filter(Boolean).length;
  const showFilters = manager || sp.filters === "1";

  return (
    <section>
      <div className="page-head">
        <h1>
          לידים <span className="count-lg">{total}</span>
        </h1>
        {can(u, "leads.export") && (
          <div className="head-actions">
            <a className="btn ghost" href={`/api/export/leads?${new URLSearchParams(Object.entries({ project: sp.project, source: sp.source, status: sp.status, owner: sp.owner }).filter(([, v]) => v) as [string, string][])}`}>
              <Icon name="upload" />
              ייצוא לאקסל
            </a>
          </div>
        )}
      </div>
      {!q && (
        <div className={"views" + (manager ? "" : " wrap")} role="group" aria-label="תצוגות">
          {viewKeys.map((k, i) => (
            <Link key={k} className={"view" + (k === view.key ? " on" : "")} href={keep({ view: k, limit: undefined })}>
              {VIEWS[k].label} <b>{counts[i]}</b>
            </Link>
          ))}
        </div>
      )}
      <div className="toolbar">
        {!manager && !q && (
          <Link className={"filter" + (fcount ? " on" : "")} href={keep({ filters: showFilters ? undefined : "1" })} aria-expanded={showFilters}>
            <Icon name="filter" />
            {showFilters ? "הסתרת הסינון" : "סינון"}
            {fcount ? ` (${fcount})` : ""}
          </Link>
        )}
        {showFilters && !q && (
          <form className="filters" action="/leads">
            <input type="hidden" name="view" value={view.key} />
            {!manager && <input type="hidden" name="filters" value="1" />}
            <label className="sel">
              <span className="sr">פרויקט</span>
              <select name="project" defaultValue={sp.project ?? ""}>
                <option value="">כל הפרויקטים</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sel">
              <span className="sr">מקור הגעה</span>
              <select name="source" defaultValue={sp.source ?? ""}>
                <option value="">כל המקורות</option>
                {[...new Set([...MANUAL_SOURCES, "טאבולה", "כתבה ממומנת"])].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="sel">
              <span className="sr">סטטוס</span>
              <select name="status" defaultValue={sp.status ?? ""}>
                <option value="">כל הסטטוסים</option>
                {ST_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {ST[s].l}
                  </option>
                ))}
              </select>
            </label>
            {manager && (
              <label className="sel">
                <span className="sr">סוכן</span>
                <select name="owner" defaultValue={sp.owner ?? ""}>
                  <option value="">כל הצוות</option>
                  <option value="none">לא שויכו</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className="btn sm">
              הצגה
            </button>
          </form>
        )}
        {q && (
          <Link className="filter on" href={keep({ q: undefined })}>
            חיפוש: {q} <Icon name="x" />
          </Link>
        )}
      </div>
      {q && <p className="search-note">{total ? `חיפשנו בכל הלידים: ${total === 1 ? "נמצא ליד אחד" : `נמצאו ${total} לידים`}` : ""}</p>}
      <LeadsTable rows={data} canBulk={manager && can(u, "leads.bulk")} people={people} query={q} canCreate={can(u, "leads.create")} />
      {total > rows.length && (
        <div className="more-row">
          <Link className="btn sm" href={keep({ limit: String(limit + 50), q: q || undefined })} scroll={false}>
            הצגת עוד {Math.min(50, total - rows.length)} מתוך {total - rows.length}
          </Link>
        </div>
      )}
    </section>
  );
}
