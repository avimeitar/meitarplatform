import { audit } from "@/lib/audit";
import { fD, fT, WD } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { hhmm, isMissingExit, monthRange, shiftMinutes } from "@/lib/hours";
import { can, getCurrentUser, requestIp } from "@/lib/session";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // keep Excel from treating text as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const date = (d: Date) => `${fD(d)}.${d.getFullYear()}`;

/** The month's hours for payroll: every shift by employee and day, with a total line per employee. Opens in Excel with Hebrew intact. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  if (!can(u, "hours.manage")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const { key, start, end } = monthRange(sp.get("month") ?? undefined);
  const now = new Date();
  const shifts = await prisma.workShift.findMany({
    where: { startAt: { gte: start, lt: end }, ...(sp.get("user") ? { userId: sp.get("user")! } : {}) },
    orderBy: [{ userId: "asc" }, { startAt: "asc" }],
    include: { user: { select: { name: true, phoneNumber: true } }, edits: { orderBy: { createdAt: "asc" } } },
  });
  const byUser = new Map<string, typeof shifts>();
  for (const s of shifts) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  const people = [...byUser.values()].sort((a, b) => a[0].user.name.localeCompare(b[0].user.name, "he"));

  const head = ["שם", "תאריך", "יום", "כניסה", "יציאה", "שעות", "שעות (עשרוני)", "רישום", "הערות"];
  const lines = [head.join(",")];
  for (const list of people) {
    let total = 0;
    const days = new Set<string>();
    for (const s of list) {
      const m = shiftMinutes(s);
      total += m;
      days.add(date(s.startAt));
      const added = (e: (typeof s.edits)[number]) => !e.before || Object.keys(e.before as object).length === 0;
      const kind = s.edits.some((e) => !added(e)) ? "תוקן" : s.startKind === "manual" || s.endKind === "manual" ? "ידני" : "חתום בטלפון";
      const notes = [
        ...(!s.endAt ? [isMissingExit(s.startAt, now) ? "חסרה שעת יציאה" : "במשמרת עכשיו"] : []),
        ...s.edits.map((e) => `${added(e) ? "נוספה" : "תוקנה"} על ידי ${e.byName} ב-${date(e.createdAt)}${e.signed ? " בחתימה" : ""}: ${e.reason}`),
      ].join(" | ");
      const nextDay = s.endAt && date(s.endAt) !== date(s.startAt) ? " (למחרת)" : "";
      lines.push(
        [s.user.name, date(s.startAt), WD[s.startAt.getDay()], fT(s.startAt), s.endAt ? fT(s.endAt) + nextDay : "", s.endAt ? hhmm(m) : "", s.endAt ? (m / 60).toFixed(2) : "", kind, notes]
          .map(cell)
          .join(","),
      );
    }
    lines.push([`סה״כ ${list[0].user.name}`, `${days.size} ימים`, "", "", "", hhmm(total), (total / 60).toFixed(2), "", ""].map(cell).join(","));
    lines.push("");
  }
  await audit({ actorId: u.id, actorName: u.name, action: "hours.export", meta: { month: key, shifts: shifts.length }, ip: await requestIp() });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="hours-${key}.csv"`, "Cache-Control": "no-store" },
  });
}
