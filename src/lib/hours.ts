// Work hours: shifts, their rules, and the month's totals.
import type { Prisma } from "@/generated/prisma/client";
import { addDays, sod } from "./crm/dates";
import { prisma } from "./db";
import { isSystemAdminRole } from "./settings";
import type { CurrentUser } from "./session";

/** How far back an employee may correct their own hours. A manager may correct any time. */
export const EDIT_DAYS = 7;
/** A shift can't be longer than this; an open one past it is missing its exit. */
export const MAX_SHIFT_HOURS = 16;

/** Agents and sales managers report hours; system administrators don't. */
export function tracksHours(u: Pick<CurrentUser, "permissions">): boolean {
  return !(u.permissions.includes("users.manage") && u.permissions.includes("roles.manage"));
}

export async function trackedUserIds(): Promise<{ id: string; name: string; active: boolean; deletedAt: Date | null }[]> {
  const users = await prisma.user.findMany({ include: { role: true }, orderBy: { name: "asc" } });
  return users.filter((u) => !isSystemAdminRole(u.role)).map((u) => ({ id: u.id, name: u.name, active: u.active, deletedAt: u.deletedAt }));
}

export type ShiftState = { open: { id: string; startAt: Date } | null; missingExit: boolean; hasDevice: boolean };

/** An open shift from an earlier day, or longer than MAX_SHIFT_HOURS, has no exit: someone forgot to sign out. */
export function isMissingExit(startAt: Date, now = new Date()): boolean {
  return startAt < sod(now) || now.getTime() - startAt.getTime() > MAX_SHIFT_HOURS * 3_600_000;
}

export async function shiftState(userId: string, now = new Date()): Promise<ShiftState> {
  const [open, devices] = await Promise.all([
    prisma.workShift.findFirst({ where: { userId, endAt: null }, orderBy: { startAt: "desc" }, select: { id: true, startAt: true } }),
    prisma.signDevice.count({ where: { userId, revokedAt: null } }),
  ]);
  return { open, missingExit: !!open && isMissingExit(open.startAt, now), hasDevice: devices > 0 };
}

/** "2026-11" → the month's first day and the next month's first day (Israel time). */
export function monthRange(month: string | undefined, now = new Date()): { key: string; start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const start = m ? new Date(+m[1], +m[2] - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  return { key, start, end };
}

/** A shift's length in minutes. It belongs whole to the day (and month) it started. An open shift counts nothing until it is closed. */
export function shiftMinutes(s: { startAt: Date; endAt: Date | null }): number {
  return s.endAt ? Math.max(0, Math.round((s.endAt.getTime() - s.startAt.getTime()) / 60_000)) : 0;
}

/** Minutes of a shift inside [from, to). An open shift counts nothing until it is closed. */
export function minutesWithin(s: { startAt: Date; endAt: Date | null }, from: Date, to: Date): number {
  if (!s.endAt) return 0;
  const a = Math.max(s.startAt.getTime(), from.getTime());
  const b = Math.min(s.endAt.getTime(), to.getTime());
  return b > a ? Math.round((b - a) / 60_000) : 0;
}

export const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const shiftInclude = { edits: { orderBy: { createdAt: "asc" } }, signatures: { select: { action: true, signedAt: true } } } satisfies Prisma.WorkShiftInclude;

export async function shiftsOf(userId: string, start: Date, end: Date) {
  return prisma.workShift.findMany({ where: { userId, startAt: { gte: start, lt: end } }, orderBy: { startAt: "asc" }, include: shiftInclude });
}

export type TeamRow = { id: string; name: string; active: boolean; days: number; minutes: number; open: number; missing: number; manual: number; edits: number; unsigned: number };

/** The month for everyone who reports hours: days worked, total, missing exits and corrections. */
export async function teamMonth(start: Date, end: Date, now = new Date()): Promise<TeamRow[]> {
  const [tracked, shifts] = await Promise.all([
    trackedUserIds(),
    prisma.workShift.findMany({ where: { startAt: { gte: start, lt: end } }, include: { _count: { select: { edits: true } } } }),
  ]);
  // someone whose role changed since still has the shifts they worked
  const known = new Set(tracked.map((p) => p.id));
  const others = [...new Set(shifts.map((s) => s.userId))].filter((id) => !known.has(id));
  const extra = others.length ? await prisma.user.findMany({ where: { id: { in: others } }, select: { id: true, name: true, active: true, deletedAt: true } }) : [];
  const people = [...tracked, ...extra].sort((a, b) => a.name.localeCompare(b.name, "he"));
  return people
    .map((p) => {
      const mine = shifts.filter((s) => s.userId === p.id);
      const days = new Set(mine.map((s) => sod(s.startAt).getTime())).size;
      return {
        id: p.id,
        name: p.name,
        active: p.active && !p.deletedAt,
        days,
        minutes: mine.reduce((n, s) => n + shiftMinutes(s), 0),
        open: mine.filter((s) => !s.endAt && !isMissingExit(s.startAt, now)).length,
        missing: mine.filter((s) => !s.endAt && isMissingExit(s.startAt, now)).length,
        manual: mine.filter((s) => s.startKind === "manual" || s.endKind === "manual").length,
        edits: mine.reduce((n, s) => n + s._count.edits, 0),
        unsigned: mine.filter((s) => s.startKind !== "signed" || (s.endAt && s.endKind !== "signed")).length,
      };
    })
    .filter((r) => r.active || r.days > 0);
}

/** May this person change this shift? Employees: their own, within EDIT_DAYS. Managers: anyone's, any time. */
export function canEditShift(u: CurrentUser, shift: { userId: string; startAt: Date }, now = new Date()): boolean {
  if (u.permissions.includes("hours.manage") && shift.userId !== u.id) return true;
  return shift.userId === u.id && shift.startAt >= addDays(sod(now), -EDIT_DAYS);
}
