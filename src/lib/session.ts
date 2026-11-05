import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authConfigured, getAuth } from "./auth";
import { prisma } from "./db";
import { rolePermissions, type Permission } from "./permissions";

export type CurrentUser = {
  id: string;
  name: string;
  firstName: string;
  phone: string | null;
  email: string;
  roleId: string;
  roleName: string;
  roleKey: string | null;
  permissions: Permission[];
};

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function can(u: Pick<CurrentUser, "permissions"> | null | undefined, p: Permission): boolean {
  return !!u && u.permissions.includes(p);
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!authConfigured().ok) return null;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, include: { role: true } });
  if (!u || !u.active || u.deletedAt) return null;
  return {
    id: u.id,
    name: u.name,
    firstName: firstName(u.name),
    phone: u.phoneNumber,
    email: u.email,
    roleId: u.roleId,
    roleName: u.role.name,
    roleKey: u.role.key,
    permissions: [...rolePermissions(u.role)],
  };
});

/** For pages: sends people who are not signed in to the sign-in screen, and people without the permission to a notice. */
export async function requirePageUser(perm?: Permission): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (perm && !can(u, perm)) redirect("/denied");
  return u;
}

export class ActionError extends Error {
  constructor(public userMessage: string, public field?: string) {
    super(userMessage);
  }
}

/** For server actions: the same checks, as an error the screen can show. */
export async function requireActionUser(perm?: Permission): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new ActionError("צריך להיכנס מחדש למערכת");
  if (perm && !can(u, perm)) throw new ActionError("אין לך הרשאה לפעולה הזו");
  return u;
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null;
}
