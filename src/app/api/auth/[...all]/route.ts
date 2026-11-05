import { authConfigured, getAuth } from "@/lib/auth";

async function handle(req: Request) {
  if (!authConfigured().ok) return Response.json({ message: "המערכת עוד לא הוגדרה" }, { status: 503 });
  return getAuth().handler(req);
}

export { handle as GET, handle as POST };
