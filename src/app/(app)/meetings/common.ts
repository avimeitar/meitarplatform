// What the meetings list and the meetings calendar share: who sees what, the filters, and the person/project choices.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/session";

export type Params = Record<string, string | undefined>;
export type Filters = { person: string; project: string };
export type Options = { people: { id: string; name: string }[]; projects: { id: string; name: string }[] };
export type MeetingsContext = {
  manager: boolean;
  who: "all" | "mine";
  scope: Prisma.MeetingWhereInput;
  mineWhere: Prisma.MeetingWhereInput;
  filters: Filters;
  options: Options;
};

export const include = { lead: { select: { id: true, name: true, phone: true, ownerId: true } }, project: { select: { name: true } }, setBy: { select: { name: true } }, host: { select: { name: true } } } as const;

/** One person's meetings: the ones they booked and the ones they hold. */
export const filterWhere = (f: Filters): Prisma.MeetingWhereInput[] => [f.person ? { OR: [{ setById: f.person }, { hostId: f.person }] } : {}, f.project ? { projectId: f.project } : {}];

/** Cancelled meetings, and ones waiting for a new date, are left out of the calendar unless asked for. */
export const NOT_ON_CALENDAR = ["cancel", "resched"];

export function canEditMeeting(u: CurrentUser, m: { setById: string | null; hostId: string | null; lead: { ownerId: string | null } | null }) {
  return can(u, "leads.edit") && (m.setById === u.id || m.hostId === u.id || m.lead?.ownerId === u.id || can(u, "meetings.manage_all"));
}

export function parseDay(s?: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whose meetings, the filters from the address, and the people and projects to choose from. */
export async function meetingsContext(u: CurrentUser, sp: Params): Promise<MeetingsContext> {
  const manager = can(u, "reports.view");
  const who = sp.who === "all" || (manager && sp.who !== "mine") ? "all" : "mine";
  const mineWhere: Prisma.MeetingWhereInput = { OR: [{ setById: u.id }, { hostId: u.id }, { lead: { ownerId: u.id } }] };
  const teamView = can(u, "leads.view_all");
  const scope: Prisma.MeetingWhereInput = teamView ? {} : mineWhere;
  const filters: Filters = { person: teamView && sp.person ? sp.person : "", project: sp.project ?? "" };
  const [people, projects] = await Promise.all([
    // a project that closed since, and someone who left, can still be looked up
    teamView
      ? prisma.user.findMany({
          where: { OR: [{ active: true, deletedAt: null }, { meetingsSet: { some: {} } }, { meetingsHosted: { some: {} } }] },
          orderBy: { name: "asc" },
          select: { id: true, name: true, active: true, deletedAt: true },
        })
      : Promise.resolve([]),
    prisma.project.findMany({ where: { OR: [{ active: true }, { meetings: { some: {} } }] }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  return {
    manager,
    who,
    scope,
    mineWhere,
    filters,
    options: {
      people: people.map((p) => ({ id: p.id, name: p.name + (p.active && !p.deletedAt ? "" : " (לא פעיל)") })),
      projects: projects.map((p) => ({ id: p.id, name: p.name + (p.active ? "" : " (לא פעיל)") })),
    },
  };
}
