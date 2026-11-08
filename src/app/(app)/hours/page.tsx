import { redirect } from "next/navigation";
import { addDays, iso, MON, sod, WD } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { canEditShift, EDIT_DAYS, isMissingExit, monthRange, shiftMinutes, shiftsOf, shiftState, teamMonth, tracksHours } from "@/lib/hours";
import { can, requirePageUser } from "@/lib/session";
import { HoursScreen, type ShiftRow } from "./HoursScreen";

export const metadata = { title: "שעות עבודה" };

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default async function HoursPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  const tracked = tracksHours(u);
  const manager = can(u, "hours.manage");
  if (!tracked && !manager) redirect("/denied");
  const sp = await searchParams;
  const now = new Date();
  const { key, start, end } = monthRange(sp.month, now);
  // whose month is open: your own, or (for a manager) someone from the team
  let viewing: { id: string; name: string; self: boolean } | null = tracked ? { id: u.id, name: u.name, self: true } : null;
  if (manager && sp.user && sp.user !== u.id) {
    const p = await prisma.user.findUnique({ where: { id: sp.user }, select: { id: true, name: true } });
    if (p) viewing = { id: p.id, name: p.name, self: false };
  }

  const [state, devices, shifts, team] = await Promise.all([
    tracked ? shiftState(u.id, now) : Promise.resolve(null),
    tracked ? prisma.signDevice.findMany({ where: { userId: u.id, revokedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true, lastUsedAt: true } }) : Promise.resolve([]),
    viewing ? shiftsOf(viewing.id, start, end) : Promise.resolve([]),
    manager ? teamMonth(start, end, now) : Promise.resolve(null),
  ]);

  const rows: ShiftRow[] = shifts.map((s) => ({
    id: s.id,
    day: iso(s.startAt),
    dayLabel: `${WD[s.startAt.getDay()]} ${s.startAt.getDate()}.${s.startAt.getMonth() + 1}`,
    start: hm(s.startAt),
    end: s.endAt ? hm(s.endAt) : null,
    endNextDay: !!s.endAt && sod(s.endAt).getTime() !== sod(s.startAt).getTime(),
    minutes: shiftMinutes(s),
    startKind: s.startKind,
    endKind: s.endKind,
    missingExit: !s.endAt && isMissingExit(s.startAt, now),
    open: !s.endAt && !isMissingExit(s.startAt, now),
    // an edit with nothing before it is a shift added by hand
    edits: s.edits.map((e) => ({ by: e.byName, reason: e.reason, at: e.createdAt.toISOString(), signed: e.signed, added: !e.before || Object.keys(e.before as object).length === 0 })),
    // a running shift is fixed after signing out of it
    canEdit: (!!s.endAt || isMissingExit(s.startAt, now)) && canEditShift(u, s, now),
  }));

  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return (
    <HoursScreen
      me={{
        tracked,
        name: u.name,
        openSince: state?.open && !state.missingExit ? state.open.startAt.toISOString() : null,
        missing:
          state?.open && state.missingExit
            ? { shiftId: state.open.id, day: iso(state.open.startAt), start: hm(state.open.startAt), canEdit: canEditShift(u, { userId: u.id, startAt: state.open.startAt }, now) }
            : null,
        hasDevice: !!state?.hasDevice,
        devices: devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt?.toISOString() ?? null })),
      }}
      month={{ key, label: `${MON[start.getMonth()]} ${start.getFullYear()}`, prev: monthKey(prev), next: next <= now ? monthKey(next) : null, current: monthKey(now) }}
      viewing={viewing}
      rows={rows}
      totalMinutes={rows.reduce((n, r) => n + r.minutes, 0)}
      days={new Set(rows.map((r) => r.day)).size}
      team={team}
      manager={manager}
      editFrom={iso(addDays(sod(now), -EDIT_DAYS))}
      today={iso(now)}
    />
  );
}
