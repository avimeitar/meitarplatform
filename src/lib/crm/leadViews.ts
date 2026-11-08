// The views and filters of the leads list, shared by the screen and its Excel export, so the file matches what is on screen.
import type { Prisma } from "@/generated/prisma/client";
import { can, type CurrentUser } from "@/lib/session";
import { isLeadStatus, OPEN_STATUSES } from "./constants";
import { addDays, sod } from "./dates";
import { leadScope } from "./views";

export type LeadView = { key: string; label: string; where: (u: CurrentUser) => Prisma.LeadWhereInput };

export const VIEWS: Record<string, LeadView> = {
  // like the call queue: new leads, and open leads whose time has come or that have no date set
  today: {
    key: "today",
    label: "לטפל היום",
    where: (u) => ({ ownerId: u.id, OR: [{ status: "new" }, { status: { in: OPEN_STATUSES.filter((s) => s !== "new" && s !== "meet") }, OR: [{ nextAt: { lt: addDays(sod(new Date()), 1) } }, { nextAt: null }] }] }),
  },
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

type Params = Record<string, string | undefined>;

/** "2026-11-01" → that day at 00:00 (Israel time); anything else → null. */
function day(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getDate() === +m[3] ? d : null;
}

/** Leads that came in between two days, both included (?from=2026-11-01&to=2026-11-08). Used by the links from the performance screen. */
export function createdRange(sp: Params): { from: Date | null; to: Date | null } {
  const from = day(sp.from);
  const to = day(sp.to);
  return { from, to };
}

/** Which view is shown, the search, the filters, and the query for the rows. */
export function leadsQuery(u: CurrentUser, sp: Params) {
  const manager = can(u, "leads.assign");
  const viewKeys = (manager ? MANAGER_VIEWS : AGENT_VIEWS).filter((k) => k !== "all" || can(u, "leads.view_all"));
  const view = VIEWS[sp.view ?? ""] && viewKeys.includes(sp.view ?? "") ? VIEWS[sp.view as string] : VIEWS[manager ? "all" : "mine"];
  const q = (sp.q ?? "").trim().slice(0, 60);
  const filters: Prisma.LeadWhereInput[] = [];
  if (sp.project) filters.push({ projectId: sp.project });
  if (sp.source) filters.push({ source: sp.source });
  if (sp.status && isLeadStatus(sp.status)) filters.push({ status: sp.status });
  if (sp.owner && manager) filters.push(sp.owner === "none" ? { ownerId: null } : { ownerId: sp.owner });
  const range = createdRange(sp);
  if (range.from || range.to) filters.push({ createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: addDays(range.to, 1) } : {}) } });
  const scope = leadScope(u);
  let where: Prisma.LeadWhereInput;
  if (q) {
    // a search looks through every lead this person may see
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    where = { AND: [scope, { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }] };
  } else where = { AND: [scope, view.where(u), ...filters] };
  return { manager, viewKeys, view, q, filters, scope, where };
}
