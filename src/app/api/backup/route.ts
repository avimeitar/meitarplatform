// GET /api/backup: the whole system's data in one file, for a system administrator to keep (for example in Google Drive).
import { audit } from "@/lib/audit";
import { buildBackup } from "@/lib/backup";
import { prisma } from "@/lib/db";
import { can, getCurrentUser, requestIp } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  if (!can(u, "archive.manage")) return new Response("Forbidden", { status: 403 });
  const now = new Date();
  const { file, counts } = await buildBackup(prisma, now);
  await audit({ actorId: u.id, actorName: u.name, action: "backup.download", meta: { leads: counts.lead ?? 0, size: file.length }, ip: await requestIp() });
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `meitar-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json.gz`;
  return new Response(new Uint8Array(file), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
