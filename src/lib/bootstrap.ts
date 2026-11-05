import { prisma } from "./db";
import { normalizePhone } from "./phone";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "./permissions";
import { createInviteLink, createUserRecord, setUserPassword } from "./users";

const DEFAULT_PROJECTS = [
  { name: "מטרופארק", fullName: "מטרופארק פתח תקווה", place: "פתח תקווה" },
  { name: "נופי הירקון", fullName: "נופי הירקון פתח תקווה", place: "פתח תקווה" },
  { name: "מטרו רעננה", fullName: "מטרו רעננה", place: "רעננה" },
  { name: "בן יהודה צפון", fullName: "בן יהודה צפון כפר סבא", place: "כפר סבא" },
  { name: "אתונה", fullName: "אתונה, יוון", place: "יוון" },
  { name: "לימסול", fullName: "לימסול, קפריסין", place: "קפריסין" },
];

/** Creates what a fresh database needs. Safe to run on every start: it never overwrites what people changed. */
export async function ensureBaseData(): Promise<void> {
  for (const key of Object.keys(BUILT_IN_ROLES) as BuiltInRoleKey[]) {
    const def = BUILT_IN_ROLES[key];
    const existing = await prisma.role.findUnique({ where: { key } });
    if (!existing) {
      await prisma.role.create({ data: { key, name: def.name, description: def.description, permissions: [...def.permissions], locked: def.locked, builtIn: true } });
    } else if (def.locked && !existing.locked) {
      await prisma.role.update({ where: { id: existing.id }, data: { locked: true } });
    }
  }
  if ((await prisma.project.count()) === 0) {
    await prisma.project.createMany({ data: DEFAULT_PROJECTS.map((p, i) => ({ ...p, sortOrder: i })) });
  }
}

/**
 * The first administrator, from Railway variables, only while the database has no users:
 * BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PHONE, optional BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.
 * Without a password, a one-time link to set one is written to the server log.
 */
export async function bootstrapAdmin(): Promise<void> {
  if ((await prisma.user.count({ where: { deletedAt: null } })) > 0) return;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const phone = normalizePhone(process.env.BOOTSTRAP_ADMIN_PHONE);
  if (!name || !phone) {
    console.warn("[bootstrap] no users yet. Set BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PHONE to create the first administrator.");
    return;
  }
  const admin = await prisma.role.findUnique({ where: { key: "admin" } });
  if (!admin) return;
  const user = await createUserRecord({ name, phone, email: process.env.BOOTSTRAP_ADMIN_EMAIL, roleId: admin.id });
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (password && password.length >= 8) {
    await setUserPassword(user.id, password);
    console.warn(`[bootstrap] created the first administrator (${name}). Sign in with the phone number and BOOTSTRAP_ADMIN_PASSWORD, then remove that variable.`);
  } else {
    const link = await createInviteLink(user.id, "invite", null);
    console.warn(`[bootstrap] created the first administrator (${name}). Set a password here (valid 72 hours): ${link.url}`);
  }
  await prisma.auditLog.create({ data: { action: "user.create", targetType: "user", targetId: user.id, targetName: name, meta: { bootstrap: true } } });
}

export async function bootstrap(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[bootstrap] DATABASE_URL is not set. Connect a PostgreSQL database in Railway.");
    return;
  }
  try {
    await ensureBaseData();
    await bootstrapAdmin();
  } catch (err) {
    console.error("[bootstrap] failed", err);
  }
}
