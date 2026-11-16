import { prisma } from "@/lib/db";
import { getLists } from "@/lib/lists";
import { requirePageUser } from "@/lib/session";
import { defaultMeetingHost } from "@/lib/settings";
import { SettingsScreen } from "./SettingsScreen";

export const metadata = { title: "רשימות והגדרות" };

export default async function SettingsPage() {
  await requirePageUser("lists.manage");
  const [lists, people, host] = await Promise.all([
    getLists(),
    prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    defaultMeetingHost(),
  ]);
  return <SettingsScreen lists={lists} people={people} host={host} />;
}
