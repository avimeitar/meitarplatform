// Every permission the system checks, with the wording managers see on the permissions screen.
export const PERMISSIONS = {
  "leads.view_all": { group: "לקוחות", label: "לראות את כל הלקוחות, גם של סוכנים אחרים" },
  "leads.create": { group: "לקוחות", label: "להוסיף לקוחות" },
  "leads.edit": { group: "לקוחות", label: "לעדכן לקוחות: פרטים, שיחות, סטטוס ופגישות" },
  "leads.assign": { group: "לקוחות", label: "לשייך לקוחות לסוכנים" },
  "leads.bulk": { group: "לקוחות", label: "פעולות על כמה לקוחות יחד" },
  "leads.delete": { group: "לקוחות", label: "למחוק לקוחות" },
  "leads.export": { group: "לקוחות", label: "לייצא לקוחות לקובץ" },
  "leads.import": { group: "לקוחות", label: "לייבא לקוחות מקובץ, למשל מפיירברי" },
  "meetings.manage_all": { group: "פגישות ומשימות", label: "לעדכן פגישות של אנשים אחרים" },
  "tasks.assign": { group: "פגישות ומשימות", label: "לתת משימות לאנשים אחרים" },
  "reports.view": { group: "דוחות", label: "לראות את דשבורד המנהל, הביצועים, הפרויקטים והעסקאות" },
  "hours.manage": { group: "שעות עבודה", label: "לראות ולתקן את שעות העבודה של כולם, ולייצא לשכר" },
  "projects.manage": { group: "הגדרות", label: "להוסיף ולערוך פרויקטים" },
  "lists.manage": { group: "הגדרות", label: "לערוך רשימות: מקורות הגעה, סיבות ל״לא רלוונטי״, שמות סטטוסים, ומי נפגש עם הלקוחות" },
  "settings.manage": { group: "הגדרות", label: "חיבורים ומפתחות לקליטת לידים" },
  "users.manage": { group: "משתמשים", label: "להוסיף, לערוך, להשבית ולמחוק משתמשים" },
  "roles.manage": { group: "משתמשים", label: "לקבוע מה כל תפקיד יכול לעשות" },
  "audit.view": { group: "משתמשים", label: "לראות את יומן הפעולות" },
  "archive.manage": { group: "משתמשים", label: "הארכיון: לראות את מה שהועבר אליו, ולהעביר אליו" },
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
    description: "רואה הכול ומחלק לקוחות, בלי ניהול משתמשים והגדרות",
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
      "hours.manage",
      "projects.manage",
      "lists.manage",
    ],
  },
  agent: {
    name: "סוכן",
    description: "עובד עם לקוחות, פגישות ומשימות",
    locked: false,
    permissions: ["leads.view_all", "leads.create", "leads.edit"],
  },
};

export type RoleLike = { locked: boolean; permissions: string[] };

/** Only the system administrators have these: they cannot be given to any other role. */
export const ADMIN_ONLY: Permission[] = ["archive.manage"];

/** The admin role always has everything, even permissions added in a later version. */
export function rolePermissions(role: RoleLike): Set<Permission> {
  if (role.locked) return new Set(ALL_PERMISSIONS);
  return new Set(role.permissions.filter((p): p is Permission => isPermission(p) && !ADMIN_ONLY.includes(p)));
}

/** A person may only hand out what they have themselves. */
export function canGrant(actor: Set<Permission>, target: Set<Permission>): boolean {
  for (const p of target) if (!actor.has(p)) return false;
  return true;
}

export function permissionGroups(): { group: string; items: { key: Permission; label: string }[] }[] {
  const groups: { group: string; items: { key: Permission; label: string }[] }[] = [];
  for (const key of ALL_PERMISSIONS) {
    // what only the system administrators have is not offered to other roles
    if (ADMIN_ONLY.includes(key)) continue;
    const { group, label } = PERMISSIONS[key];
    let g = groups.find((x) => x.group === group);
    if (!g) groups.push((g = { group, items: [] }));
    g.items.push({ key, label });
  }
  return groups;
}
