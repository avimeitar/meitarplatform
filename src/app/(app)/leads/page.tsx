import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import { ST, ST_ORDER } from "@/lib/crm/constants";
import { getLists } from "@/lib/lists";
import { fD } from "@/lib/crm/dates";
import { createdRange, leadsQuery, VIEWS } from "@/lib/crm/leadViews";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, requirePageUser } from "@/lib/session";
import { LeadsTable, type LeadRow } from "./LeadsTable";
import { AutoSubmitForm } from "@/components/ui/AutoSubmitForm";

export const metadata = { title: "לקוחות" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const { manager, viewKeys, view, q, filters, scope, where } = leadsQuery(u, sp);
  const limit = Math.min(500, Math.max(50, Number(sp.limit) || 50));

  const orderBy: Prisma.LeadOrderByWithRelationInput[] = ["today", "noans", "resched", "follow"].includes(view.key) && !q ? [{ nextAt: "asc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }];
  const [rows, total, counts, projects, users, stored, lists] = await Promise.all([
    prisma.lead.findMany({ where, orderBy, take: limit, include: { project: { select: { name: true } }, owner: { select: { name: true } } } }),
    prisma.lead.count({ where }),
    Promise.all(viewKeys.map((k) => prisma.lead.count({ where: { AND: [scope, VIEWS[k].where(u), ...filters] } }))),
    // the filters offer what the clients actually have: a project that closed since, and someone who left, too
    prisma.project.findMany({ where: { OR: [{ active: true }, { leads: { some: scope } }] }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    prisma.user.findMany({ where: { OR: [{ active: true, deletedAt: null }, { ownedLeads: { some: scope } }] }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true, deletedAt: true } }),
    prisma.lead.groupBy({ by: ["source"], where: scope }),
    getLists(),
  ]);
  // who can receive clients: only people who are still here
  const people = users.filter((p) => p.active && !p.deletedAt).map((p) => ({ id: p.id, name: p.name }));
  const owners = users.map((p) => ({ id: p.id, name: p.name + (p.active && !p.deletedAt ? "" : " (לא פעיל)") }));

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
    const merged = { view: view.key, project: sp.project, source: sp.source, status: sp.status, owner: sp.owner, from: sp.from, to: sp.to, filters: sp.filters, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/leads?${p.toString()}`;
  };
  const fcount = [sp.project, sp.source, sp.status, manager ? sp.owner : undefined].filter(Boolean).length;
  const range = createdRange(sp);
  const rangeText = range.from && range.to ? (range.from.getTime() === range.to.getTime() ? `ב-${fD(range.from)}` : `בין ${fD(range.from)} ל-${fD(range.to)}`) : range.from ? `מ-${fD(range.from)}` : range.to ? `עד ${fD(range.to)}` : "";
  // the sources on the list first, then any other source clients came from (Fireberry, the intake API)
  const others = stored.map((x) => x.source).filter((x) => !lists.sources.includes(x));
  const sources = [...new Set([...lists.sources, ...others.sort((x, y) => x.localeCompare(y, "he")), ...(sp.source ? [sp.source] : [])])];
  const showFilters = manager || sp.filters === "1";

  return (
    <section>
      <div className="page-head">
        <h1>
          לקוחות <span className="count-lg">{total}</span>
        </h1>
        {can(u, "leads.export") && (
          <div className="head-actions">
            <a className="btn ghost" href={`/api/export/leads?${new URLSearchParams(Object.entries({ view: view.key, q: q || undefined, project: sp.project, source: sp.source, status: sp.status, owner: sp.owner, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][])}`}>
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
          <AutoSubmitForm className="filters" action="/leads">
            <input type="hidden" name="view" value={view.key} />
            {!manager && <input type="hidden" name="filters" value="1" />}
            {range.from && <input type="hidden" name="from" value={sp.from} />}
            {range.to && <input type="hidden" name="to" value={sp.to} />}
            <label className="sel">
              <span className="sr">פרויקט</span>
              <select name="project" defaultValue={sp.project ?? ""}>
                <option value="">כל הפרויקטים</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name + (p.active ? "" : " (לא פעיל)")}
                  </option>
                ))}
              </select>
            </label>
            <label className="sel">
              <span className="sr">מקור הגעה</span>
              <select name="source" defaultValue={sp.source ?? ""}>
                <option value="">כל המקורות</option>
                {sources.map((s) => (
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
                <span className="sr">מנהל לקוח</span>
                <select name="owner" defaultValue={sp.owner ?? ""}>
                  <option value="">כל הצוות</option>
                  <option value="none">לא שויכו</option>
                  {owners.map((p) => (
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
          </AutoSubmitForm>
        )}
        {rangeText && !q && (
          <Link className="filter on" href={keep({ from: undefined, to: undefined })} aria-label={`נכנסו ${rangeText}. הסרת הסינון לפי תאריך`}>
            נכנסו {rangeText} <Icon name="x" />
          </Link>
        )}
        {q && (
          <Link className="filter on" href={keep({ q: undefined })}>
            חיפוש: {q} <Icon name="x" />
          </Link>
        )}
      </div>
      {q && <p className="search-note">{total ? `חיפשנו בכל הלקוחות: ${total === 1 ? "נמצא לקוח אחד" : `נמצאו ${total} לקוחות`}` : ""}</p>}
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
