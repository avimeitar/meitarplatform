// GET /waze: a short, public link to navigate to the office, for the messages clients get on WhatsApp
// (the full Waze link is long, because the address is in Hebrew).
import { OFFICE } from "@/lib/crm/constants";

export function GET() {
  return new Response(null, { status: 302, headers: { Location: OFFICE.waze, "Cache-Control": "public, max-age=3600" } });
}
