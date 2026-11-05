import { prisma } from "@/lib/db";
import { canGrant, rolePermissions } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { requirePageUser } from "@/lib/session";
import { isPlaceholderEmail } from "@/lib/users";
import { UsersScreen, type RoleRow, type UserRow } from "./UsersScreen";

export const metadata = { title: "משתמשים" };

export default async function UsersPage() {
  const me = await requirePageUser("users.manage");
  const mine = new Set(me.permissions);
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      include: { role: true, accounts: { where: { providerId: "credential" }, select: { id: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.role.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: formatPhone(u.phoneNumber),
    email: isPlaceholderEmail(u.email) ? "" : u.email,
    roleId: u.roleId,
    roleName: u.role.name,
    active: u.active,
    hasPassword: u.accounts.length > 0,
    lastLogin: u.lastLoginAt?.toISOString() ?? null,
    autoAssign: u.autoAssign,
    manageable: canGrant(mine, rolePermissions(u.role)),
    isMe: u.id === me.id,
  }));
  const roleRows: RoleRow[] = roles.map((r) => ({ id: r.id, name: r.name, key: r.key, grantable: canGrant(mine, rolePermissions(r)) }));
  return <UsersScreen users={rows} roles={roleRows} />;
}
