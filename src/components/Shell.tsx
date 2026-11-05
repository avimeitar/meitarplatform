"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/Icon";
import { useDrawer, Overlays } from "@/components/ui/Overlays";
import { NewLeadForm, type PersonOption, type ProjectOption } from "@/components/leads/NewLeadForm";
import type { Permission } from "@/lib/permissions";

export type ShellUser = { id: string; name: string; firstName: string; roleName: string; permissions: Permission[] };
export type NavCounts = Partial<Record<"work" | "leads" | "meetings" | "tasks", number>>;

type NavItem = { href: string; label: string; icon: IconName; key?: keyof NavCounts; need?: Permission[] };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "עבודה יומית",
    items: [
      { href: "/dashboard", label: "ראשי", icon: "home" },
      { href: "/work", label: "תור שיחות", icon: "phone", key: "work" },
      { href: "/leads", label: "לידים", icon: "users", key: "leads" },
      { href: "/meetings", label: "פגישות", icon: "cal", key: "meetings" },
      { href: "/tasks", label: "משימות", icon: "check", key: "tasks" },
    ],
  },
  {
    group: "ניהול",
    items: [
      { href: "/projects", label: "פרויקטים", icon: "grid", need: ["reports.view"] },
      { href: "/deals", label: "עסקאות סגורות", icon: "chart", need: ["reports.view"] },
    ],
  },
  {
    group: "הגדרות",
    items: [
      { href: "/users", label: "משתמשים", icon: "users", need: ["users.manage"] },
      { href: "/roles", label: "הרשאות", icon: "shield", need: ["roles.manage"] },
      { href: "/intake", label: "קליטת לידים", icon: "link", need: ["settings.manage"] },
      { href: "/audit", label: "יומן פעולות", icon: "list", need: ["audit.view"] },
    ],
  },
];

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

function ShellInner({ user, counts, projects, people, children }: { user: ShellUser; counts: NavCounts; projects: ProjectOption[]; people: PersonOption[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const drawer = useDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [q, setQ] = useState("");
  const has = (p: Permission) => user.permissions.includes(p);

  useEffect(() => {
    setMenuOpen(false);
    setMeOpen(false);
  }, [pathname]);

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  function openNewLead() {
    drawer.open({ title: "ליד חדש", content: <NewLeadForm projects={projects} people={people} canAssign={has("leads.assign")} me={user} /> });
  }

  async function signOut() {
    await signOutAction();
    window.location.assign("/login");
  }

  return (
    <div className="app">
      <aside className={"side" + (menuOpen ? " open" : "")} aria-label="תפריט">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.webp" alt="מיתר נדל״ן והשקעות" />
        </div>
        <nav className="nav" aria-label="ניווט ראשי">
          {NAV.map((g) => {
            const items = g.items.filter((it) => !it.need || it.need.some(has));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <p className="nav-group">{g.group}</p>
                {items.map((it) => {
                  const n = it.key ? counts[it.key] : 0;
                  return (
                    <Link key={it.href} href={it.href} className={active(it.href) ? "on" : ""} aria-current={active(it.href) ? "page" : undefined}>
                      <Icon name={it.icon} />
                      {it.label}
                      {n ? <span className="count">{n}</span> : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="me-wrap">
          <button type="button" className="me" aria-expanded={meOpen} onClick={() => setMeOpen((v) => !v)}>
            <span className="av p1">{initials(user.name)}</span>
            <div>
              <b>{user.name}</b>
              <small>{user.roleName}</small>
            </div>
            <Icon name="chev" />
          </button>
          {meOpen && (
            <div className="me-pop">
              <Link href="/account">
                <Icon name="lock" />
                החשבון שלי והסיסמה
              </Link>
              <button type="button" onClick={signOut}>
                <Icon name="out" />
                יציאה מהמערכת
              </button>
            </div>
          )}
        </div>
      </aside>
      {menuOpen && <div className="scrim side-scrim" onClick={() => setMenuOpen(false)} />}

      <header className="top">
        <button type="button" className="ib mob" aria-label="פתיחת התפריט" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="top-mark mob" src="/brand/mark-blue.webp" alt="" />
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const v = q.trim();
            router.push(v ? `/leads?q=${encodeURIComponent(v)}` : "/leads");
          }}
        >
          <Icon name="search" />
          <input type="search" placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש לידים" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        {has("leads.create") && (
          <button type="button" className="btn primary new-lead" onClick={openNewLead}>
            <Icon name="plus" />
            ליד חדש
          </button>
        )}
      </header>

      <main className="main" id="main">
        {children}
      </main>

      <nav className="tabbar" aria-label="ניווט מהיר">
        {[
          { href: "/dashboard", label: "ראשי", icon: "home" as IconName },
          { href: "/leads", label: "לידים", icon: "users" as IconName },
          { href: "/work", label: "שיחות", icon: "phone" as IconName },
          { href: "/meetings", label: "פגישות", icon: "cal" as IconName },
        ].map((t) => (
          <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""}>
            <Icon name={t.icon} />
            {t.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" />
          עוד
        </button>
      </nav>
    </div>
  );
}

export function Shell(props: { user: ShellUser; counts: NavCounts; projects: ProjectOption[]; people: PersonOption[]; children: ReactNode }) {
  return (
    <Overlays>
      <ShellInner {...props} />
    </Overlays>
  );
}
