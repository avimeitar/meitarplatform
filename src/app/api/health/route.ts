import { authConfigured } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Railway's health check. Answers 200 even before the database is connected; it says no more than whether the site is set up.
export async function GET() {
  let db = "missing";
  if (process.env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = "ok";
    } catch {
      db = "error";
    }
  }
  return Response.json({ ok: true, db, configured: authConfigured().ok });
}
