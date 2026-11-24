// /api/meta/webhook: Meta tells us a lead came in from a Facebook or Instagram Lead Ads form.
//   GET   Meta checks the address when the webhook is set up: it sends back our verify word and a challenge.
//   POST  a delivery, signed with the app secret. It only names the lead; its answers are read from the Graph API.
// A delivery that could not be taken gets a 500, and Meta sends it again later (a lead is never taken twice).
import { prisma } from "@/lib/db";
import { leadgenChanges, metaConfig, metaVerifyToken, signatureOk } from "@/lib/meta";
import { takeMetaLead } from "@/lib/metaLeads";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === metaVerifyToken() && q.get("hub.challenge"))
    return new Response(q.get("hub.challenge"), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const cfg = metaConfig();
  if (!cfg) return new Response("Not configured", { status: 503 });
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) return new Response("Bad signature", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  let failed = 0;
  for (const c of leadgenChanges(body)) {
    const page = await prisma.metaPage.findUnique({ where: { id: c.pageId } });
    // a page that is not connected (or was disconnected): nothing to do
    if (!page || !page.active) continue;
    try {
      await takeMetaLead(cfg, page, c.leadgenId);
    } catch (e) {
      failed++;
      console.error("[meta] could not take lead", c.leadgenId, e);
      await prisma.metaPage.update({ where: { id: page.id }, data: { lastError: (e instanceof Error ? e.message : "שגיאה").slice(0, 300) } }).catch(() => {});
    }
  }
  return new Response(failed ? "Retry later" : "OK", { status: failed ? 500 : 200 });
}
