import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import { ImportScreen } from "./ImportScreen";

export const metadata = { title: "ייבוא מפיירברי" };

export default async function ImportPage() {
  await requirePageUser("leads.import");
  const [projects, users] = await Promise.all([
    prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { deletedAt: null }, orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  return <ImportScreen projects={projects} users={users} />;
}
