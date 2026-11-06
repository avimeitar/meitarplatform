import { authConfigured, CLIENT_IP_HEADER, clientIp, getAuth } from "@/lib/auth";

// Only the sign-in endpoints the app uses are reachable; everything else Better Auth offers answers 404.
const ALLOWED: Record<string, string[]> = {
  POST: [
    "/sign-in/phone-number",
    "/sign-in/email",
    "/two-factor/send-otp",
    "/two-factor/verify-otp",
    "/phone-number/request-password-reset",
    "/phone-number/reset-password",
    "/change-password",
    "/revoke-other-sessions",
    "/sign-out",
  ],
  GET: ["/get-session", "/ok"],
};

async function handle(req: Request) {
  if (!authConfigured().ok) return Response.json({ message: "המערכת עוד לא הוגדרה" }, { status: 503 });
  const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "").replace(/\/$/, "");
  if (!ALLOWED[req.method]?.includes(path)) return new Response("Not Found", { status: 404 });
  // rate limits count per real client address: the last one in X-Forwarded-For, added by Railway's proxy
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = clientIp(req.headers);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  return getAuth().handler(new Request(req.url, { method: req.method, headers, body }));
}

export { handle as GET, handle as POST };
