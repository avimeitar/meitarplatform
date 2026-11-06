"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/Icon";
import { useDrawer, Overlays } from "@/components/ui/Overlays";
import { NewLeadForm, type PersonOption, type ProjectOption } from "@/components/leads/NewLeadForm";
import type { Permission } from "@/lib/permissions";

// Opens the "new lead" form from anywhere (for example from an empty search, with the number filled in).
const NewLeadCtx = createContext<(prefill?: string) => void>(() => {});
export const useNewLead = () => useContext(NewLeadCtx);

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
      { href: "/import", label: "ייבוא מפיירברי", icon: "upload", need: ["leads.import"] },
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

  // the phone menu: focus moves into it when it opens, and Escape closes it
  useEffect(() => {
    if (!menuOpen) return;
    document.querySelector<HTMLElement>(".side .nav a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      document.querySelector<HTMLElement>(".top .menu-btn")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  function openNewLead(prefill?: string) {
    drawer.open({ title: "ליד חדש", content: <NewLeadForm projects={projects} people={people} canAssign={has("leads.assign")} me={user} prefill={prefill} /> });
  }

  async function signOut() {
    await signOutAction();
    window.location.assign("/login");
  }

  return (
    <NewLeadCtx.Provider value={openNewLead}>
    <div className="app">
      <aside id="side-menu" className={"side" + (menuOpen ? " open" : "")} aria-label="תפריט">
        <button type="button" className="ib side-close" aria-label="סגירת התפריט" onClick={() => setMenuOpen(false)}>
          <Icon name="x" />
        </button>
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
        <button type="button" className="ib mob menu-btn" aria-label="פתיחת התפריט" aria-expanded={menuOpen} aria-controls="side-menu" onClick={() => setMenuOpen(true)}>
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
          <button type="button" className="btn primary new-lead" onClick={() => openNewLead()}>
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
          { href: "/work", label: "תור שיחות", icon: "phone" as IconName },
          { href: "/meetings", label: "פגישות", icon: "cal" as IconName },
        ].map((t) => (
          <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""} aria-current={active(t.href) ? "page" : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </Link>
        ))}
        <button type="button" aria-expanded={menuOpen} aria-controls="side-menu" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" />
          עוד
        </button>
      </nav>
    </div>
    </NewLeadCtx.Provider>
  );
}

export function Shell(props: { user: ShellUser; counts: NavCounts; projects: ProjectOption[]; people: PersonOption[]; children: ReactNode }) {
  return (
    <Overlays>
      <ShellInner {...props} />
    </Overlays>
  );
}
