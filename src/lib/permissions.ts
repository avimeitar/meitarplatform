// Every permission the system checks, with the wording managers see on the permissions screen.
export const PERMISSIONS = {
  "leads.view_all": { group: "לידים", label: "לראות את כל הלידים, גם של סוכנים אחרים" },
  "leads.create": { group: "לידים", label: "להוסיף לידים" },
  "leads.edit": { group: "לידים", label: "לעדכן לידים: פרטים, שיחות, סטטוס ופגישות" },
  "leads.assign": { group: "לידים", label: "להעביר לידים בין סוכנים" },
  "leads.bulk": { group: "לידים", label: "פעולות על כמה לידים יחד" },
  "leads.delete": { group: "לידים", label: "למחוק לידים" },
  "leads.export": { group: "לידים", label: "לייצא לידים לקובץ" },
  "leads.import": { group: "לידים", label: "לייבא לידים מקובץ, למשל מפיירברי" },
  "meetings.manage_all": { group: "פגישות ומשימות", label: "לעדכן פגישות של אנשים אחרים" },
  "tasks.assign": { group: "פגישות ומשימות", label: "לתת משימות לאנשים אחרים" },
  "reports.view": { group: "דוחות", label: "לראות את דשבורד המנהל, הפרויקטים והעסקאות" },
  "projects.manage": { group: "הגדרות", label: "להוסיף ולערוך פרויקטים" },
  "settings.manage": { group: "הגדרות", label: "חיבורים ומפתחות לקליטת לידים" },
  "users.manage": { group: "משתמשים", label: "להוסיף, לערוך, להשבית ולמחוק משתמשים" },
  "roles.manage": { group: "משתמשים", label: "לקבוע מה כל תפקיד יכול לעשות" },
  "audit.view": { group: "משתמשים", label: "לראות את יומן הפעולות" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(p: string): p is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, p);
}

export type BuiltInRoleKey = "admin" | "manager" | "agent";

export const BUILT_IN_ROLES: Record<BuiltInRoleKey, { name: string; description: string; locked: boolean; permissions: Permission[] }> = {
  admin: {
    name: "מנהל מערכת",
    description: "גישה מלאה, כולל משתמשים, הרשאות והגדרות",
    locked: true,
    permissions: ALL_PERMISSIONS,
  },
  manager: {
    name: "מנהל מכירות",
    description: "רואה הכול ומחלק לידים, בלי ניהול משתמשים והגדרות",
    locked: false,
    permissions: [
      "leads.view_all",
      "leads.create",
      "leads.edit",
      "leads.assign",
      "leads.bulk",
      "leads.export",
      "meetings.manage_all",
      "tasks.assign",
      "reports.view",
      "projects.manage",
    ],
  },
  agent: {
    name: "סוכן",
    description: "עובד עם לידים, פגישות ומשימות",
    locked: false,
    permissions: ["leads.view_all", "leads.create", "leads.edit"],
  },
};

export type RoleLike = { locked: boolean; permissions: string[] };

/** The admin role always has everything, even permissions added in a later version. */
export function rolePermissions(role: RoleLike): Set<Permission> {
  if (role.locked) return new Set(ALL_PERMISSIONS);
  return new Set(role.permissions.filter(isPermission));
}

/** A person may only hand out what they have themselves. */
export function canGrant(actor: Set<Permission>, target: Set<Permission>): boolean {
  for (const p of target) if (!actor.has(p)) return false;
  return true;
}

export function permissionGroups(): { group: string; items: { key: Permission; label: string }[] }[] {
  const groups: { group: string; items: { key: Permission; label: string }[] }[] = [];
  for (const key of ALL_PERMISSIONS) {
    const { group, label } = PERMISSIONS[key];
    let g = groups.find((x) => x.group === group);
    if (!g) groups.push((g = { group, items: [] }));
    g.items.push({ key, label });
  }
  return groups;
}
