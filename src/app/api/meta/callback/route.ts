// /api/meta/callback: back from signing in to Facebook. The pages chosen there are saved, subscribed to new leads,
// and their leads from the last 90 days are brought in. A supplier's pages get the supplier's source and project.
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { appBaseURL } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MetaError, metaConfig, pagesFromLogin, sealToken, subscribePage } from "@/lib/meta";
import { inviteById } from "@/lib/metaInvites";
import { pullAll } from "@/lib/metaLeads";
import { can, getCurrentUser, requestIp } from "@/lib/session";

export const dynamic = "force-dynamic";

function done(to: string) {
  const res = NextResponse.redirect(`${appBaseURL()}${to}`);
  res.cookies.set("meta_state", "", { path: "/api/meta", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cookie = decodeURIComponent(req.headers.get("cookie")?.match(/(?:^|;\s*)meta_state=([^;]+)/)?.[1] ?? "");
  const [state, inviteId] = cookie.split(".");
  const invite = inviteId ? await inviteById(inviteId) : null;
  // where to send the person back: a supplier to their thank-you page, a manager to the intake screen
  const back = (status: string, extra = "") => done(inviteId ? `/connect/facebook/done?status=${status}${extra}` : `/intake?meta=${status}${extra}#meta`);

  let actor: { id: string; name: string } | null = null;
  if (!inviteId) {
    const u = await getCurrentUser();
    if (!u) return done("/login");
    if (!can(u, "settings.manage")) return done("/denied");
    actor = { id: u.id, name: u.name };
  } else if (!invite) return back("expired");
  const cfg = metaConfig();
  if (!cfg) return back("setup");
  if (!state || q.get("state") !== state) return back("expired");
  if (q.get("error") || !q.get("code")) return back("denied");

  try {
    const pages = await pagesFromLogin(cfg, q.get("code") as string);
    if (!pages.length) return back("nopages");
    let subscribed = 0;
    for (const p of pages) {
      let lastError: string | null = null;
      try {
        await subscribePage(cfg, p.id, p.token);
        subscribed++;
      } catch (e) {
        lastError = `לא הצלחנו להירשם ללידים של העמוד: ${e instanceof Error ? e.message : ""}`.slice(0, 300);
      }
      const owner = invite ? { supplier: invite.supplier, source: invite.source, projectId: invite.projectId, inviteId: invite.id } : { supplier: null, source: null, projectId: null, inviteId: null };
      await prisma.metaPage.upsert({
        where: { id: p.id },
        create: { id: p.id, name: p.name, token: sealToken(p.token), connectedById: actor?.id ?? null, lastError, ...owner },
        update: { name: p.name, token: sealToken(p.token), active: true, connectedById: actor?.id ?? null, connectedAt: new Date(), lastError, ...owner },
      });
    }
    if (invite) await prisma.metaInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    await audit({
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? (invite ? `ספק: ${invite.supplier}` : null),
      action: "meta.connect",
      meta: { pages: pages.map((p) => p.name).join(", "), ...(invite ? { supplier: invite.supplier } : {}) },
      ip: await requestIp(),
    });
    // what came in before connecting: the last 90 days, in the background
    pullAll(() => new Date(Date.now() - 90 * 86_400_000)).catch((e) => console.error("[meta] first pull failed", e));
    return back("connected", `&pages=${pages.length}&subscribed=${subscribed}`);
  } catch (e) {
    console.error("[meta] connecting failed", e);
    return back("failed", `&why=${encodeURIComponent(e instanceof MetaError ? e.message.slice(0, 200) : "")}`);
  }
}
