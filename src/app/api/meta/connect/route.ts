// /api/meta/connect: sign in to Facebook to connect pages.
//   A system administrator connects the company's own pages (from the intake screen).
//   A lead supplier connects their page with an invite link (?invite=...), without an account in the system.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appBaseURL } from "@/lib/auth";
import { loginUrl, metaConfig } from "@/lib/meta";
import { liveInvite } from "@/lib/metaInvites";
import { can, getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const base = appBaseURL();
  const cfg = metaConfig();
  const inviteSecret = new URL(req.url).searchParams.get("invite");
  let inviteId = "";
  if (inviteSecret) {
    const inv = await liveInvite(inviteSecret);
    if (!inv) return NextResponse.redirect(`${base}/connect/facebook/${encodeURIComponent(inviteSecret)}`);
    if (!cfg) return NextResponse.redirect(`${base}/connect/facebook/done?status=unavailable`);
    inviteId = inv.id;
  } else {
    const u = await getCurrentUser();
    if (!u) return NextResponse.redirect(`${base}/login`);
    if (!can(u, "settings.manage")) return NextResponse.redirect(`${base}/denied`);
    if (!cfg) return NextResponse.redirect(`${base}/intake?meta=setup#meta`);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(loginUrl(cfg!, state));
  // the state, and the invite it belongs to, come back with the person from Facebook
  res.cookies.set("meta_state", inviteId ? `${state}.${inviteId}` : state, { httpOnly: true, secure: base.startsWith("https://"), sameSite: "lax", path: "/api/meta", maxAge: 900 });
  return res;
}
