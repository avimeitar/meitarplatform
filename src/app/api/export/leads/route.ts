import { audit } from "@/lib/audit";
import { ST, type LeadStatus } from "@/lib/crm/constants";
import { leadsQuery } from "@/lib/crm/leadViews";
import { fD, fT } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can, getCurrentUser, requestIp } from "@/lib/session";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // keep Excel from treating text as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const when = (d: Date | null) => (d ? `${fD(d)}.${d.getFullYear()} ${fT(d)}` : "");

/** Leads as a CSV that opens in Excel with Hebrew intact. Respects the person's permissions and the screen's filters. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  if (!can(u, "leads.export")) return new Response("Forbidden", { status: 403 });
  // the same view, search and filters as the screen the button was pressed on
  const { where } = leadsQuery(u, Object.fromEntries(new URL(req.url).searchParams));
  const rows = await prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: 50_000, include: { project: { select: { name: true } }, owner: { select: { name: true } } } });
  const head = ["שם", "טלפון", "אימייל", "פרויקט", "מקור הגעה", "סטטוס", "סיבה", "סוכן", "נוצר", "מתי לחזור", "ניסיונות בלי מענה", "אישור דיוור"];
  const lines = [head.join(",")];
  for (const l of rows)
    lines.push(
      [l.name, formatPhone(l.phone), l.email ?? "", l.project?.name ?? "", l.source, ST[l.status as LeadStatus]?.l ?? l.status, l.lostReason ?? "", l.owner?.name ?? "", when(l.createdAt), when(l.nextAt), l.attempts, l.consent ? "כן" : "לא"]
        .map(cell)
        .join(","),
    );
  await audit({ actorId: u.id, actorName: u.name, action: "lead.export", meta: { count: rows.length }, ip: await requestIp() });
  const name = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
