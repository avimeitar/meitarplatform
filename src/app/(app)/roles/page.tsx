import { prisma } from "@/lib/db";
import { canGrant, permissionGroups, rolePermissions } from "@/lib/permissions";
import { requirePageUser } from "@/lib/session";
import { RolesScreen, type RoleView } from "./RolesScreen";

export const metadata = { title: "הרשאות" };

export default async function RolesPage() {
  const me = await requirePageUser("roles.manage");
  const mine = new Set(me.permissions);
  const roles = await prisma.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { users: { where: { deletedAt: null } } } } } });
  const views: RoleView[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    locked: r.locked,
    builtIn: r.builtIn,
    users: r._count.users,
    permissions: [...rolePermissions(r)],
    editable: !r.locked && canGrant(mine, rolePermissions(r)),
  }));
  return <RolesScreen roles={views} groups={permissionGroups()} mine={me.permissions} />;
}
