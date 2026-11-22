import { archiveQuery } from "@/app/(app)/archive/query";
import { dayTime, statusText } from "@/app/(app)/archive/labels";
import { audit } from "@/lib/audit";
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

/** What is in the archive, as a CSV that opens in Excel with Hebrew intact, with the screen's search and filters. System administrators only. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  if (!can(u, "archive.manage")) return new Response("Forbidden", { status: 403 });
  const { kind, where } = archiveQuery(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await prisma.archiveRecord.findMany({ where, orderBy: { at: "desc" }, take: 100_000 });
  const head = ["שם", "טלפון", "אימייל", "מקור הגעה", "פרויקט", "סטטוס", "אחראי", kind === "meeting" ? "מועד" : kind === "task" ? "עד מתי" : "נוצר", "שיחות והערות"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const d = (r.data ?? {}) as { email?: string | null; source?: string | null; confirmed?: boolean; activities?: unknown[] };
    lines.push(
      [r.name, r.phone ? formatPhone(r.phone) : "", d.email ?? "", d.source ?? "", r.project ?? "", statusText(kind, r.status, !!d.confirmed), r.owner ?? "", dayTime(r.at), Array.isArray(d.activities) ? d.activities.length : ""]
        .map(cell)
        .join(","),
    );
  }
  await audit({ actorId: u.id, actorName: u.name, action: "archive.export", meta: { count: rows.length }, ip: await requestIp() });
  const name = `archive-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
