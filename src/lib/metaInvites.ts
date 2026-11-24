// Links that lead suppliers open to connect their own Facebook page. The link carries a secret; only its hash is kept.
import { createHash, randomBytes } from "node:crypto";
import { appBaseURL } from "./auth";
import { prisma } from "./db";

export const INVITE_DAYS = 30;
const hash = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");

export async function createInvite(d: { supplier: string; source: string; projectId: string | null; byId: string }): Promise<{ id: string; link: string }> {
  const secret = randomBytes(24).toString("base64url");
  const row = await prisma.metaInvite.create({
    data: { hash: hash(secret), supplier: d.supplier, source: d.source, projectId: d.projectId, createdById: d.byId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  return { id: row.id, link: `${appBaseURL()}/connect/facebook/${secret}` };
}

/** The invite behind a link, while it can still be used. */
export async function liveInvite(secret: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const inv = await prisma.metaInvite.findUnique({ where: { hash: hash(secret) } });
  if (!inv || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function inviteById(id: string) {
  const inv = await prisma.metaInvite.findUnique({ where: { id } });
  if (!inv || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}
