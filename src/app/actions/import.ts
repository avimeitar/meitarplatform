"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { ST } from "@/lib/crm/constants";
import { prisma } from "@/lib/db";
import { guessProject, mapStatus, readFireberry } from "@/lib/fireberry";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

export type ImportPreview = {
  total: number;
  valid: number;
  badPhone: number;
  dupInFile: number;
  existing: number;
  sources: { source: string; count: number; projectId: string }[];
  owners: { name: string; count: number; userId: string }[];
  statuses: { from: string; count: number; to: string }[];
};

const MAX_ROWS = 20000;

function parse(csv: string) {
  if (!csv || csv.length > 15_000_000) throw new ActionError("הקובץ גדול מדי. אפשר לפצל אותו לכמה קבצים");
  const r = readFireberry(csv);
  if (r.missing.length) throw new ActionError("לא מצאנו בקובץ עמודה של " + r.missing.map((m) => (m === "name" ? "שם לקוח" : "טלפון")).join(" ו") + ". צריך קובץ ייצוא של לידים מפיירברי (CSV)");
  if (r.rows.length > MAX_ROWS) throw new ActionError(`בקובץ יותר מ-${MAX_ROWS} שורות. אפשר לפצל אותו`);
  return r.rows;
}

export async function previewImportAction(csv: string): Promise<ActionResult<ImportPreview>> {
  return run(async () => {
    await requireActionUser("leads.import");
    const rows = parse(String(csv ?? ""));
    const [projects, users] = await Promise.all([
      prisma.project.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const seen = new Set<string>();
    let dup = 0;
    const phones: string[] = [];
    for (const r of rows) {
      if (!r.phone) continue;
      if (seen.has(r.phone)) dup++;
      else {
        seen.add(r.phone);
        phones.push(r.phone);
      }
    }
    let existing = 0;
    for (let i = 0; i < phones.length; i += 1000) existing += await prisma.lead.count({ where: { phone: { in: phones.slice(i, i + 1000) } } });
    const count = <K extends string>(get: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, number>();
      for (const r of rows) if (r.phone) m.set(get(r), (m.get(get(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      data: {
        total: rows.length,
        valid: seen.size,
        badPhone: rows.filter((r) => !r.phone).length,
        dupInFile: dup,
        existing,
        sources: count((r) => r.source || "לא צוין").map(([source, n]) => ({ source, count: n, projectId: guessProject(source, projects) })),
        owners: count((r) => r.owner || "").filter(([n]) => n).map(([name, n]) => ({ name, count: n, userId: users.find((u) => u.name === name)?.id ?? "" })),
        statuses: count((r) => r.status || "").map(([from, n]) => ({ from: from || "ללא סטטוס", count: n, to: ST[mapStatus(from).status].l + (mapStatus(from).reason && from !== "לא רלוונטי" ? ` (${mapStatus(from).reason})` : "") })),
      },
    };
  });
}

export async function runImportAction(csv: string, map: { sources: Record<string, string>; owners: Record<string, string> }): Promise<ActionResult<{ created: number; merged: number; skipped: number }>> {
  return run(async () => {
    const u = await requireActionUser("leads.import");
    const rows = parse(String(csv ?? ""));
    const projectIds = new Set((await prisma.project.findMany({ select: { id: true } })).map((p) => p.id));
    const userIds = new Set((await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } })).map((x) => x.id));
    const proj = (source: string) => {
      const id = map?.sources?.[source || "לא צוין"];
      return id && projectIds.has(id) ? id : null;
    };
    const owner = (name: string) => {
      const id = map?.owners?.[name];
      return id && userIds.has(id) ? id : null;
    };
    const seen = new Set<string>();
    const good = rows.filter((r) => r.phone && r.name && !seen.has(r.phone) && seen.add(r.phone));
    let created = 0;
    let merged = 0;
    for (let i = 0; i < good.length; i += 200) {
      const batch = good.slice(i, i + 200);
      await prisma.$transaction(async (tx) => {
        const existing = new Map((await tx.lead.findMany({ where: { phone: { in: batch.map((r) => r.phone as string) } }, select: { id: true, phone: true } })).map((l) => [l.phone, l.id]));
        for (const r of batch) {
          const phone = r.phone as string;
          const note = `יובא מפיירברי${r.owner ? `. מנהל לקוח בפיירברי: ${r.owner}` : ""}${r.status ? `. סטטוס בפיירברי: ${r.status}` : ""}`;
          const leadId = existing.get(phone);
          if (leadId) {
            await tx.inquiry.create({ data: { leadId, source: r.source || "פיירברי", projectId: proj(r.source), campaign: r.ad || null, payload: { fireberry: true } } });
            await tx.activity.create({ data: { leadId, kind: "in", text: "פנייה מפיירברי נוספה לכרטיס הקיים", auto: note, userId: u.id } });
            merged++;
            continue;
          }
          const { status, reason } = mapStatus(r.status);
          const createdAt = r.created ?? new Date();
          await tx.lead.create({
            data: {
              name: r.name,
              phone,
              email: r.email || null,
              source: r.source || "פיירברי",
              projectId: proj(r.source),
              status,
              lostReason: reason,
              ownerId: owner(r.owner),
              nextAt: r.next,
              closedAt: status === "won" ? createdAt : null,
              createdAt,
              lastActivityAt: createdAt,
              createdById: u.id,
              inquiries: { create: { source: r.source || "פיירברי", projectId: proj(r.source), campaign: r.ad || null, payload: { fireberry: true }, createdAt } },
              activities: { create: { kind: "in", text: "יובא מפיירברי", auto: note, userId: u.id, createdAt } },
            },
          });
          created++;
        }
      }, { timeout: 120_000 });
    }
    const skipped = rows.length - good.length;
    await audit({ actorId: u.id, actorName: u.name, action: "lead.import", meta: { created, merged, skipped }, ip: await requestIp() });
    revalidatePath("/", "layout");
    return { message: `הייבוא הסתיים: ${created} לידים חדשים, ${merged} צורפו לכרטיסים קיימים, ${skipped} שורות דולגו`, data: { created, merged, skipped } };
  });
}
