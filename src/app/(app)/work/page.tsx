import { queueRows } from "@/lib/crm/views";
import { requirePageUser } from "@/lib/session";
import { WorkScreen } from "./WorkScreen";

export const metadata = { title: "תור שיחות" };

export default async function WorkPage() {
  const u = await requirePageUser("leads.edit");
  const rows = await queueRows(u.id);
  return <WorkScreen rows={rows} />;
}
