// Every filter in the platform, checked in a real browser against the database: each choice a person can
// make, the rows it shows and the counts next to it. Run it like run.mjs, with the server's database as well:
//   DATABASE_URL=<the server's database> DEVLOG=/tmp/dev.log ADMIN_PHONE=... ADMIN_PASS=... npm run e2e:filters
// It adds a few rows the demo data lacks (a closed project, a former employee, sources from Fireberry,
// an imported meeting), all with "fx-" ids, and leaves them in place for the next run.
import fs from "node:fs";
import { createRequire } from "node:module";

// the server counts days in Israel time, and so does this check
process.env.TZ = "Asia/Jerusalem";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const LOG = process.env.DEVLOG;
const ADMIN = [process.env.ADMIN_PHONE || "050-0000001", process.env.ADMIN_PASS || "test-pass-1234"];
const AGENT = [process.env.AGENT_PHONE || "050-0000011", process.env.AGENT_PASS || "demo-pass-1234"];
if (!LOG || !process.env.DATABASE_URL) throw new Error("Set DEVLOG (the server's log) and DATABASE_URL (the server's database)");

const results = [];
const ok = (name, cond, info) => results.push(`${cond ? "PASS" : "FAIL"} ${name}${info !== undefined ? `  [${String(info).slice(0, 160)}]` : ""}`);
const same = (name, shown, expected) => ok(name, shown === expected, `shown ${shown}, expected ${expected}`);
const lastCode = () => {
  const m = [...fs.readFileSync(LOG, "utf8").matchAll(/\[otp\] (?:login|reset) code for \S+ by \w+: (\d{6})/g)];
  return m.length ? m[m.length - 1][1] : null;
};

// ---- the database: what each filter should show ----
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (from, params = []) => Number((await rows(`SELECT count(*)::int AS n FROM ${from}`, params))[0].n);
// the columns hold UTC times without a zone
const ts = (d) => d.toISOString();
const sod = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const weekStart = (d) => addDays(sod(d), -sod(d).getDay());
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isWorkday = (d) => d.getDay() !== 5 && d.getDay() !== 6;
const nextWorkday = (now) => {
  let x = addDays(sod(now), 1);
  while (!isWorkday(x)) x = addDays(x, 1);
  return x;
};

async function fixtures() {
  const agentRole = (await rows(`SELECT id FROM "Role" WHERE key = 'agent'`))[0].id;
  const utcNow = `(now() AT TIME ZONE 'UTC')`;
  await db.query(`INSERT INTO "Project" (id, name, "fullName", place, active, "sortOrder") VALUES ('fx-proj-closed', 'פרויקט שנסגר', 'פרויקט שנסגר (בדיקה)', '', false, 99) ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO "user" (id, name, email, "createdAt", "updatedAt", "roleId", active, "phoneNumber") VALUES ('fx-user-gone', 'עובדת לשעבר', 'fx-gone@example.invalid', ${utcNow}, ${utcNow}, $1, false, '+972500000099') ON CONFLICT DO NOTHING`,
    [agentRole],
  );
  const open = (await rows(`SELECT id FROM "Project" WHERE active ORDER BY "sortOrder" LIMIT 1`))[0].id;
  const leads = [
    ["fx-lead-1", "לקוח מפיירברי אחד", "+972509990001", "פייסבוק - אתונה", "fx-proj-closed", "fx-user-gone", "process", null, 3],
    ["fx-lead-2", "לקוח מפיירברי שניים", "+972509990002", "פייסבוק - אתונה", null, null, "new", null, 2],
    ["fx-lead-3", "לקוח מפיירברי שלושה", "+972509990003", "צביקה- מטרו 190", open, "fx-user-gone", "lost", "הכחשת פנייה", 1],
  ];
  for (const [id, name, phone, source, projectId, ownerId, status, lostReason, ago] of leads)
    await db.query(
      `INSERT INTO "Lead" (id, name, phone, source, "projectId", "ownerId", status, "lostReason", "createdAt", "updatedAt", "lastActivityAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${utcNow} - make_interval(days => $9), ${utcNow}, ${utcNow}) ON CONFLICT DO NOTHING`,
      [id, name, phone, source, projectId, ownerId, status, lostReason, ago],
    );
  // this week: a meeting imported from Fireberry (its rep has no user here, its project closed since),
  // and one that is waiting to be booked again
  const monday = addDays(weekStart(new Date()), 1);
  const orna = (await rows(`SELECT id FROM "user" WHERE "phoneNumber" = '+972500000011'`))[0]?.id ?? null;
  const meetings = [
    ["fx-meet-1", "לקוח מיובא", "אתונה", "נציג מפיירברי", "fx-proj-closed", new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 11, 0), "set", null],
    ["fx-meet-2", "לקוח לתיאום מחדש", null, null, open, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 13, 0), "resched", orna],
  ];
  for (const [id, client, subject, rep, projectId, at, status, setById] of meetings)
    await db.query(
      `INSERT INTO "Meeting" (id, "clientName", subject, "repName", "projectId", "startAt", place, status, "setById", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'משרד, פתח תקווה', $7, $8, ${utcNow}, ${utcNow}) ON CONFLICT DO NOTHING`,
      [id, client, subject, rep, projectId, ts(at), status, setById],
    );
}

// ---- the browser ----
async function login(p, [phone, pass]) {
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=username]", phone);
  await p.fill("input[name=password]", pass);
  await p.click("button[type=submit]");
  await Promise.race([p.waitForURL("**/dashboard", { timeout: 15000 }), p.waitForSelector('h1:has-text("לאן לשלוח"), h1:has-text("מקלידים")', { timeout: 15000 })]).catch(() => {});
  if (p.url().endsWith("/dashboard")) return;
  if (await p.locator('h1:has-text("לאן לשלוח")').count()) await p.click(".opt >> nth=0");
  await p.waitForSelector(".code-input");
  await p.waitForTimeout(400);
  await p.fill(".code-input", lastCode());
  await p.waitForURL("**/dashboard", { timeout: 20000 });
}
const settle = async (p) => {
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(150);
};
const param = (p, name) => new URL(p.url()).searchParams.get(name) ?? "";
/** The select inside a label whose hidden text names it ("פרויקט", "מקור הגעה"...). */
const sel = (p, label) => p.locator(`label.sel:has(> span.sr:text-is("${label}")) select`).first();
const options = (s) => s.evaluate((el) => [...el.options].map((o) => ({ value: o.value, label: o.textContent.trim() })));
/** Pick an option the way a person does, and wait for the screen to follow. */
async function choose(p, s, value, name) {
  await s.selectOption(value);
  await p.waitForURL((u) => (u.searchParams.get(name) ?? "") === value, { timeout: 15000 }).catch(() => {});
  await settle(p);
}
const num = async (loc) => Number(((await loc.first().textContent({ timeout: 5000 }).catch(() => "")) || "").replace(/[^\d]/g, "") || NaN);

const browser = await chromium.launch();
const errors = [];
const desk = { viewport: { width: 1400, height: 900 }, timezoneId: "Asia/Jerusalem", locale: "he-IL" };
try {
  await fixtures();
  const adminId = (await rows(`SELECT id FROM "user" WHERE "phoneNumber" = $1`, ["+972" + ADMIN[0].replace(/\D/g, "").slice(1)]))[0].id;
  const agentId = (await rows(`SELECT id FROM "user" WHERE "phoneNumber" = $1`, ["+972" + AGENT[0].replace(/\D/g, "").slice(1)]))[0].id;
  const a = await (await browser.newContext(desk)).newPage();
  a.on("pageerror", (e) => errors.push("admin: " + e.message));
  await login(a, ADMIN);

  // =============================================================== clients, as a manager
  const total = (p) => num(p.locator("h1 .count-lg"));
  const L = (where = "true", params = []) => count(`"Lead" WHERE ${where}`, params);
  const VIEWS = {
    all: "true",
    new: "status = 'new'",
    unassigned: `"ownerId" IS NULL`,
    noans: "status = 'noans'",
    meet: "status = 'meet'",
    resched: "status = 'resched'",
    follow: "status IN ('held', 'follow')",
    won: "status = 'won'",
    lost: "status = 'lost'",
  };
  await a.goto(`${BASE}/leads`);
  for (const [key, where] of Object.entries(VIEWS)) {
    const tab = a.locator(`.views a[href*="view=${key}&"], .views a[href$="view=${key}"]`).first();
    const badge = await num(tab.locator("b"));
    await tab.click();
    await a.waitForURL((u) => u.searchParams.get("view") === key).catch(() => {});
    await settle(a);
    const want = await L(where);
    same(`clients: the "${key}" view lists its clients`, await total(a), want);
    same(`clients: the "${key}" tab counts its clients`, badge, want);
  }

  await a.goto(`${BASE}/leads?view=all`);
  const all = await L();
  // project
  const projOpts = await options(sel(a, "פרויקט"));
  const withLeads = await rows(`SELECT DISTINCT p.id, p.name FROM "Lead" l JOIN "Project" p ON p.id = l."projectId"`);
  const missingProj = withLeads.filter((x) => !projOpts.some((o) => o.value === x.id)).map((x) => x.name);
  ok("clients: every project that has clients can be chosen, closed ones too", !missingProj.length, missingProj.join(", "));
  for (const o of projOpts.filter((o) => o.value)) {
    await choose(a, sel(a, "פרויקט"), o.value, "project");
    const want = await L(`"projectId" = $1`, [o.value]);
    same(`clients: project "${o.label}"`, await total(a), want);
    const shown = await a.locator("table.leads tbody td.c-proj").allTextContents();
    const name = withLeads.find((x) => x.id === o.value)?.name ?? o.label;
    ok(`clients: project "${o.label}" shows only its clients`, shown.every((t) => t.trim() === name), shown.find((t) => t.trim() !== name));
    ok(`clients: project "${o.label}" stays chosen`, (await sel(a, "פרויקט").inputValue()) === o.value);
  }
  await choose(a, sel(a, "פרויקט"), "", "project");
  same("clients: back to all projects", await total(a), all);
  // source
  const srcOpts = await options(sel(a, "מקור הגעה"));
  const sources = (await rows(`SELECT DISTINCT source FROM "Lead"`)).map((r) => r.source);
  const missingSrc = sources.filter((s) => !srcOpts.some((o) => o.value === s));
  ok("clients: every source that clients came from can be chosen", !missingSrc.length, missingSrc.join(", "));
  for (const o of srcOpts.filter((o) => o.value)) {
    await choose(a, sel(a, "מקור הגעה"), o.value, "source");
    same(`clients: source "${o.value}"`, await total(a), await L(`source = $1`, [o.value]));
    const shown = await a.locator("table.leads tbody td.c-src").allTextContents();
    ok(`clients: source "${o.value}" shows only its clients`, shown.every((t) => t.trim() === o.value), shown.find((t) => t.trim() !== o.value));
  }
  await choose(a, sel(a, "מקור הגעה"), "", "source");
  // status
  for (const o of (await options(sel(a, "סטטוס"))).filter((o) => o.value)) {
    await choose(a, sel(a, "סטטוס"), o.value, "status");
    same(`clients: status "${o.label}"`, await total(a), await L(`status = $1`, [o.value]));
  }
  await choose(a, sel(a, "סטטוס"), "", "status");
  // client manager
  const ownerOpts = await options(sel(a, "מנהל לקוח"));
  const owners = await rows(`SELECT DISTINCT u.id, u.name FROM "Lead" l JOIN "user" u ON u.id = l."ownerId"`);
  const missingOwner = owners.filter((x) => !ownerOpts.some((o) => o.value === x.id)).map((x) => x.name);
  ok("clients: everyone who has clients can be chosen, former employees too", !missingOwner.length, missingOwner.join(", "));
  for (const o of ownerOpts.filter((o) => o.value)) {
    await choose(a, sel(a, "מנהל לקוח"), o.value, "owner");
    same(`clients: client manager "${o.label}"`, await total(a), o.value === "none" ? await L(`"ownerId" IS NULL`) : await L(`"ownerId" = $1`, [o.value]));
  }
  await choose(a, sel(a, "מנהל לקוח"), "", "owner");
  // two filters together, then a view tab that keeps them
  const big = (await rows(`SELECT "projectId" AS id FROM "Lead" WHERE "projectId" IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`))[0].id;
  await choose(a, sel(a, "פרויקט"), big, "project");
  await choose(a, sel(a, "סטטוס"), "new", "status");
  same("clients: project and status together", await total(a), await L(`"projectId" = $1 AND status = 'new'`, [big]));
  await a.click(`.views a[href*="view=unassigned"]`);
  await a.waitForURL((u) => u.searchParams.get("view") === "unassigned").catch(() => {});
  await settle(a);
  ok("clients: a view tab keeps the filters", param(a, "project") === big && param(a, "status") === "new");
  same("clients: view, project and status together", await total(a), await L(`"projectId" = $1 AND status = 'new' AND "ownerId" IS NULL`, [big]));
  ok("clients: the export follows the filters", /project=.*status=new/.test((await a.locator('a:has-text("ייצוא לאקסל")').getAttribute("href")) ?? ""));
  // the days they came in (the links from the performance screen)
  const from = addDays(sod(new Date()), -6);
  const to = sod(new Date());
  await a.goto(`${BASE}/leads?view=all&from=${iso(from)}&to=${iso(to)}`);
  same("clients: the days they came in", await total(a), await L(`"createdAt" >= $1 AND "createdAt" < $2`, [ts(from), ts(addDays(to, 1))]));
  await choose(a, sel(a, "סטטוס"), "new", "status");
  ok("clients: a filter keeps the days", param(a, "from") === iso(from) && param(a, "to") === iso(to));
  same("clients: the days and a status together", await total(a), await L(`"createdAt" >= $1 AND "createdAt" < $2 AND status = 'new'`, [ts(from), ts(addDays(to, 1))]));
  await a.click(".toolbar a.filter.on:has-text('נכנסו')");
  await a.waitForURL((u) => !u.searchParams.get("from")).catch(() => {});
  await settle(a);
  same("clients: removing the days", await total(a), await L(`status = 'new'`));
  // search: by name and by phone, across every client
  const someone = (await rows(`SELECT name, phone FROM "Lead" WHERE id NOT LIKE 'fx-%' ORDER BY "createdAt" LIMIT 1`))[0];
  const word = someone.name.split(/\s+/).pop();
  await a.fill('input[aria-label="חיפוש לקוחות"]', word);
  await a.press('input[aria-label="חיפוש לקוחות"]', "Enter");
  await a.waitForURL((u) => u.searchParams.get("q") === word).catch(() => {});
  await settle(a);
  same(`clients: search "${word}"`, await total(a), await L(`(name ILIKE $1 OR email ILIKE $1)`, [`%${word}%`]));
  const local = "0" + someone.phone.slice(4);
  const typed = `${local.slice(0, 3)}-${local.slice(3)}`;
  await a.fill('input[aria-label="חיפוש לקוחות"]', typed);
  await a.press('input[aria-label="חיפוש לקוחות"]', "Enter");
  await a.waitForURL((u) => u.searchParams.get("q") === typed).catch(() => {});
  await settle(a);
  same(`clients: search by phone ${typed}`, await total(a), await L(`phone LIKE $1`, [`%${local.slice(1)}%`]));
  // more rows
  await a.goto(`${BASE}/leads?view=all`);
  await a.click('.more-row a:has-text("הצגת עוד")');
  await a.waitForURL((u) => u.searchParams.get("limit") === "100").catch(() => {});
  await settle(a);
  same("clients: showing more", await a.locator("table.leads tbody tr").count(), Math.min(100, all));

  // =============================================================== clients, as an agent
  const g = await (await browser.newContext(desk)).newPage();
  g.on("pageerror", (e) => errors.push("agent: " + e.message));
  await login(g, AGENT);
  const tomorrow = addDays(sod(new Date()), 1);
  const AGENT_VIEWS = {
    today: [`"ownerId" = $1 AND (status = 'new' OR (status IN ('process', 'noans', 'resched', 'held', 'follow') AND ("nextAt" < $2 OR "nextAt" IS NULL)))`, [agentId, ts(tomorrow)]],
    mine: [`"ownerId" = $1`, [agentId]],
    new: ["status = 'new'", []],
    resched: ["status = 'resched'", []],
    all: ["true", []],
  };
  await g.goto(`${BASE}/leads`);
  for (const [key, [where, params]] of Object.entries(AGENT_VIEWS)) {
    const tab = g.locator(`.views a[href*="view=${key}&"], .views a[href$="view=${key}"]`).first();
    if (!(await tab.count())) {
      ok(`agent clients: the "${key}" view is there`, false);
      continue;
    }
    await tab.click();
    await g.waitForURL((u) => u.searchParams.get("view") === key).catch(() => {});
    await settle(g);
    same(`agent clients: the "${key}" view`, await total(g), await L(where, params));
  }
  await g.click('.views a[href*="view=mine"]');
  await settle(g);
  await g.click('.toolbar a.filter:has-text("סינון")');
  await g.waitForURL((u) => u.searchParams.get("filters") === "1").catch(() => {});
  await settle(g);
  await choose(g, sel(g, "סטטוס"), "process", "status");
  same(`agent clients: "mine" with a status`, await total(g), await L(`"ownerId" = $1 AND status = 'process'`, [agentId]));
  ok("agent clients: the filters stay open after a choice", (await sel(g, "סטטוס").count()) === 1);
  const agentProj = (await options(sel(g, "פרויקט"))).filter((o) => o.value)[0];
  await choose(g, sel(g, "פרויקט"), agentProj.value, "project");
  same(`agent clients: "mine" with a status and a project`, await total(g), await L(`"ownerId" = $1 AND status = 'process' AND "projectId" = $2`, [agentId, agentProj.value]));

  // =============================================================== meetings: the list
  const now = new Date();
  const today = sod(now);
  const next = nextWorkday(now);
  const M = (where, params = []) => count(`"Meeting" m LEFT JOIN "Lead" l ON l.id = m."leadId" WHERE ${where}`, params);
  const RANGES = {
    today: [`m."startAt" >= $1 AND m."startAt" < $2`, [ts(today), ts(addDays(today, 1))]],
    next: [`m."startAt" >= $1 AND m."startAt" < $2`, [ts(next), ts(addDays(next, 1))]],
    week: [`m."startAt" >= $1 AND m."startAt" < $2`, [ts(weekStart(now)), ts(addDays(weekStart(now), 7))]],
    upcoming: [`m."startAt" >= $1`, [ts(now)]],
    past: [`m."startAt" < $1`, [ts(now)]],
    stale: [`m."startAt" < $1 AND m.status = 'set'`, [ts(now)]],
  };
  const listRows = (p) => p.locator("table.mtable tbody tr:not(.grp)");
  const allTab = (p) => num(p.locator('.mviews a:has-text("הכול") b'));
  await a.goto(`${BASE}/meetings?view=list&who=all`);
  for (const [key, [where, params]] of Object.entries(RANGES)) {
    await a.click(`.toolbar .seg a[href*="range=${key}"]`);
    await a.waitForURL((u) => u.searchParams.get("range") === key).catch(() => {});
    await settle(a);
    const want = await M(where, params);
    same(`meetings list: "${key}" counts its meetings`, await allTab(a), want);
    same(`meetings list: "${key}" lists its meetings`, await listRows(a).count(), Math.min(100, want));
  }
  const STATES = { set: "m.status = 'set' AND NOT m.confirmed", confirmed: "m.status = 'set' AND m.confirmed", held: "m.status = 'held'", noshow: "m.status = 'noshow'", cancel: "m.status = 'cancel'", resched: "m.status = 'resched'" };
  await a.goto(`${BASE}/meetings?view=list&who=all&range=past`);
  for (const [st, where] of Object.entries(STATES)) {
    const tab = a.locator(`.mviews a[href*="st=${st}"]`).first();
    const badge = await num(tab.locator("b"));
    await tab.click();
    await a.waitForURL((u) => u.searchParams.get("st") === st).catch(() => {});
    await settle(a);
    const want = await M(`${RANGES.past[0]} AND ${where}`, RANGES.past[1]);
    same(`meetings list: past "${st}" tab counts`, badge, want);
    same(`meetings list: past "${st}" tab lists`, await listRows(a).count(), Math.min(100, want));
  }
  await a.goto(`${BASE}/meetings?view=list&who=mine&range=past`);
  same(`meetings list: "mine"`, await allTab(a), await M(`${RANGES.past[0]} AND (m."setById" = $2 OR m."hostId" = $2 OR l."ownerId" = $2)`, [...RANGES.past[1], adminId]));
  // person and project, like in the calendar
  await a.goto(`${BASE}/meetings?view=list&who=all&range=week`);
  const listPerson = sel(a, "של מי");
  if (await listPerson.count()) {
    await choose(a, listPerson, agentId, "person");
    same("meetings list: one person's meetings", await allTab(a), await M(`${RANGES.week[0]} AND (m."setById" = $3 OR m."hostId" = $3)`, [...RANGES.week[1], agentId]));
    await choose(a, sel(a, "של מי"), "", "person");
  } else ok("meetings list: can show one person's meetings", false, "no person filter on the list");
  const listProject = sel(a, "פרויקט");
  if (await listProject.count()) {
    await choose(a, listProject, "fx-proj-closed", "project").catch(() => ok("meetings list: a closed project can be chosen", false));
    same("meetings list: one project's meetings", await allTab(a), await M(`${RANGES.week[0]} AND m."projectId" = 'fx-proj-closed'`, RANGES.week[1]));
  } else ok("meetings list: can show one project's meetings", false, "no project filter on the list");
  // search, by name or subject, at any date
  const client = (await rows(`SELECT l.name FROM "Meeting" m JOIN "Lead" l ON l.id = m."leadId" ORDER BY m."startAt" LIMIT 1`))[0].name.split(/\s+/)[0];
  await a.goto(`${BASE}/meetings?view=list&who=all`);
  await a.fill('input[aria-label="חיפוש פגישות"]', client);
  await a.press('input[aria-label="חיפוש פגישות"]', "Enter");
  await a.waitForURL((u) => u.searchParams.get("q") === client).catch(() => {});
  await settle(a);
  const found = await M(`(m."clientName" ILIKE $1 OR l.name ILIKE $1 OR m.subject ILIKE $1)`, [`%${client}%`]);
  same(`meetings list: search "${client}"`, await listRows(a).count(), Math.min(100, found));
  await a.goto(`${BASE}/meetings?view=list&who=all&q=${encodeURIComponent("אתונה")}`);
  same(`meetings list: search by subject`, await listRows(a).count(), Math.min(100, await M(`(m."clientName" ILIKE $1 OR l.name ILIKE $1 OR m.subject ILIKE $1)`, ["%אתונה%"])));

  // =============================================================== meetings: the calendar
  const ws = weekStart(now);
  const WEEK = [`m."startAt" >= $1 AND m."startAt" < $2`, [ts(ws), ts(addDays(ws, 7))]];
  const HIDDEN = `m.status NOT IN ('cancel', 'resched')`;
  const events = (p) => p.locator(".cev").count();
  await a.goto(`${BASE}/calendar?mode=week&who=all&date=${iso(today)}`);
  same("calendar: the week", await events(a), await M(`${WEEK[0]} AND ${HIDDEN}`, WEEK[1]));
  const calPeople = (await options(sel(a, "של מי"))).filter((o) => o.value);
  for (const o of calPeople) {
    await choose(a, sel(a, "של מי"), o.value, "person");
    same(`calendar: ${o.label}'s week`, await events(a), await M(`${WEEK[0]} AND ${HIDDEN} AND (m."setById" = $3 OR m."hostId" = $3)`, [...WEEK[1], o.value]));
    ok(`calendar: ${o.label} stays chosen`, (await sel(a, "של מי").inputValue()) === o.value);
  }
  await choose(a, sel(a, "של מי"), "", "person");
  const calProjects = await options(sel(a, "פרויקט"));
  ok("calendar: a closed project with meetings can be chosen", calProjects.some((o) => o.value === "fx-proj-closed"));
  for (const o of calProjects.filter((o) => o.value)) {
    await choose(a, sel(a, "פרויקט"), o.value, "project");
    same(`calendar: project "${o.label}"`, await events(a), await M(`${WEEK[0]} AND ${HIDDEN} AND m."projectId" = $3`, [...WEEK[1], o.value]));
  }
  await choose(a, sel(a, "פרויקט"), "", "project");
  // a click, as a person would: the box shows the choice once the calendar has it
  await a.click(".cal-cancel input");
  await a.waitForURL((u) => u.searchParams.get("cancelled") === "1").catch(() => {});
  await settle(a);
  same("calendar: with cancelled meetings", await events(a), await M(WEEK[0], WEEK[1]));
  await a.click('.cal-nav a[aria-label="השבוע הבא"]');
  await a.waitForURL((u) => u.searchParams.get("date") === iso(addDays(today, 7))).catch(() => {});
  await settle(a);
  ok("calendar: the next week keeps the filters", param(a, "cancelled") === "1" && param(a, "who") === "all");
  same("calendar: the next week", await events(a), await M(`m."startAt" >= $1 AND m."startAt" < $2`, [ts(addDays(ws, 7)), ts(addDays(ws, 14))]));
  await a.goto(`${BASE}/calendar?mode=week&who=mine&date=${iso(today)}`);
  same(`calendar: "mine"`, await events(a), await M(`${WEEK[0]} AND ${HIDDEN} AND (m."setById" = $3 OR m."hostId" = $3 OR l."ownerId" = $3)`, [...WEEK[1], adminId]));
  // an old link to the calendar on the meetings screen leads to the calendar, filters and all
  await a.goto(`${BASE}/meetings?view=cal&mode=week&who=all&person=${agentId}`);
  await a.waitForURL("**/calendar**", { timeout: 10000 }).catch(() => {});
  ok("meetings: an old calendar link opens the calendar with its filters", new URL(a.url()).pathname === "/calendar" && param(a, "person") === agentId);

  // =============================================================== tasks
  const RECENT = new Date(Date.now() - 15 * 60_000);
  const OPEN = `(t.done = false OR (t.done AND NOT t.voided AND t."doneAt" >= $1))`;
  const TASKS = {
    open: [OPEN, [ts(RECENT)]],
    late: [`${OPEN} AND t."dueAt" < $2`, [ts(RECENT), ts(today)]],
    today: [`${OPEN} AND t."dueAt" >= $2 AND t."dueAt" < $3`, [ts(RECENT), ts(today), ts(addDays(today, 1))]],
    done: [`t.done AND NOT t.voided AND t."doneAt" >= $1`, [ts(weekStart(now))]],
  };
  const T = (where, params) => count(`"Task" t WHERE ${where}`, params);
  await a.goto(`${BASE}/tasks`);
  const taskPeople = (await options(sel(a, "של מי"))).filter((o) => o.value);
  for (const [f, [where, params]] of Object.entries(TASKS)) {
    await a.click(`.toolbar .seg a[href*="f=${f}"]`);
    await a.waitForURL((u) => u.searchParams.get("f") === f).catch(() => {});
    await settle(a);
    same(`tasks: "${f}" for the whole team`, await a.locator(".tlist .trow").count(), Math.min(300, await T(where, params)));
    for (const o of taskPeople) {
      await choose(a, sel(a, "של מי"), o.value, "user");
      ok(`tasks: "${f}" keeps its tab for ${o.label}`, param(a, "f") === f);
      same(`tasks: "${f}" for ${o.label}`, await a.locator(".tlist .trow").count(), Math.min(300, await T(`${where} AND t."userId" = $${params.length + 1}`, [...params, o.value])));
    }
    await choose(a, sel(a, "של מי"), "", "user");
  }

  // =============================================================== closed deals
  const dealsSince = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const dealsUntil = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const DEALS = [`status = 'won' AND "closedAt" IS NOT NULL AND "closedAt" >= $1 AND "closedAt" < $2`, [ts(dealsSince), ts(dealsUntil)]];
  const dealsKpi = (p) => num(p.locator('.kpi:has(> span:text-is("ב-6 חודשים")) > b'));
  const waitDeals = async (p) => {
    await p.waitForSelector(".toolbar[aria-busy]", { state: "detached", timeout: 10000 }).catch(() => {});
    await settle(p);
  };
  await a.goto(`${BASE}/deals`);
  same("deals: everyone", await dealsKpi(a), await L(DEALS[0], DEALS[1]));
  for (const o of (await options(sel(a, "מנהל לקוח"))).filter((o) => o.value)) {
    await choose(a, sel(a, "מנהל לקוח"), o.value, "agent");
    await waitDeals(a);
    same(`deals: ${o.label}`, await dealsKpi(a), await L(`${DEALS[0]} AND "ownerId" = $3`, [...DEALS[1], o.value]));
    ok(`deals: ${o.label} stays chosen`, (await sel(a, "מנהל לקוח").inputValue()) === o.value);
  }
  await choose(a, sel(a, "מנהל לקוח"), "", "agent");
  for (const o of (await options(sel(a, "פרויקט"))).filter((o) => o.value)) {
    await choose(a, sel(a, "פרויקט"), o.value, "project");
    await waitDeals(a);
    same(`deals: project "${o.label}"`, await dealsKpi(a), await L(`${DEALS[0]} AND "projectId" = $3`, [...DEALS[1], o.value]));
  }

  // =============================================================== performance
  const tile = (p) => num(p.locator('.perf-kpis .kpi:has(> span:text-is("לקוחות חדשים")) > b'));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const PERF = [`"createdAt" >= $1 AND "createdAt" < $2`, [ts(monthStart), ts(new Date())]];
  await a.goto(`${BASE}/performance`);
  same("performance: new clients this month", await tile(a), await L(PERF[0], PERF[1]));
  for (const o of (await options(sel(a, "פרויקט"))).filter((o) => o.value)) {
    await choose(a, sel(a, "פרויקט"), o.value, "project");
    await waitDeals(a);
    same(`performance: project "${o.label}"`, await tile(a), await L(`${PERF[0]} AND "projectId" = $3`, [...PERF[1], o.value]));
  }
  await choose(a, sel(a, "פרויקט"), "", "project");
  const perfSources = (await options(sel(a, "מקור הגעה"))).filter((o) => o.value);
  const missingPerfSrc = sources.filter((s) => !perfSources.some((o) => o.value === s));
  ok("performance: every source can be chosen", !missingPerfSrc.length, missingPerfSrc.join(", "));
  for (const o of perfSources) {
    await choose(a, sel(a, "מקור הגעה"), o.value, "source");
    await waitDeals(a);
    same(`performance: source "${o.value}"`, await tile(a), await L(`${PERF[0]} AND source = $3`, [...PERF[1], o.value]));
  }
  await choose(a, sel(a, "מקור הגעה"), "", "source");
  for (const o of (await options(sel(a, "נציג"))).filter((o) => o.value)) {
    await choose(a, sel(a, "נציג"), o.value, "rep");
    await waitDeals(a);
    same(`performance: rep ${o.label}`, await tile(a), await L(`${PERF[0]} AND "ownerId" = $3`, [...PERF[1], o.value]));
  }
  await choose(a, sel(a, "נציג"), "", "rep");
  await a.click('.perf-tools .seg button:has-text("3 חודשים")');
  await a.waitForURL((u) => u.searchParams.get("p") === "3m").catch(() => {});
  await waitDeals(a);
  same("performance: three months", await tile(a), await L(`"createdAt" >= $1 AND "createdAt" < $2`, [ts(new Date(now.getFullYear(), now.getMonth() - 2, 1)), ts(new Date())]));
  // a rare source, straight from the address (the source table links like this)
  const rare = (await rows(`SELECT source FROM "Lead" GROUP BY 1 ORDER BY count(*), source LIMIT 1`))[0].source;
  await a.goto(`${BASE}/performance?p=3m&source=${encodeURIComponent(rare)}`);
  same(`performance: a rare source from a link ("${rare}")`, await tile(a), await L(`"createdAt" >= $1 AND "createdAt" < $2 AND source = $3`, [ts(new Date(now.getFullYear(), now.getMonth() - 2, 1)), ts(new Date()), rare]));
  ok("performance: the rare source shows as chosen", (await sel(a, "מקור הגעה").inputValue()) === rare);

  // =============================================================== audit log
  await a.goto(`${BASE}/audit`);
  const tabs = await a.locator(".toolbar .seg a").evaluateAll((els) => els.map((e) => ({ href: e.getAttribute("href"), label: e.textContent.trim() })));
  const sig = (p) => p.locator("table.audit tbody tr:not(:has(td.empty))").evaluateAll((trs) => trs.map((tr) => [...tr.children].slice(0, 4).map((td) => td.textContent.trim()).join("|")));
  const newest = await sig(a);
  const covered = new Set();
  for (const t of tabs.filter((x) => x.href.includes("g="))) {
    const key = new URL(t.href, BASE).searchParams.get("g");
    await a.click(`.toolbar .seg a[href="${t.href}"]`);
    await a.waitForURL((u) => u.searchParams.get("g") === key).catch(() => {});
    await settle(a);
    const shown = await sig(a);
    const want = await count(`"AuditLog" WHERE action LIKE $1`, [`${key}.%`]);
    same(`audit: "${t.label}"`, shown.length, Math.min(100, want));
    for (const x of shown) covered.add(x);
  }
  // the newest actions under "הכול" each show under one of the tabs
  const left = newest.filter((x) => !covered.has(x));
  ok("audit: every kind of action has a tab", !left.length, left.slice(0, 3).join(" ; "));

  // =============================================================== work hours, dashboard, projects
  await a.goto(`${BASE}/hours?user=${agentId}`);
  const agentName = (await rows(`SELECT name FROM "user" WHERE id = $1`, [agentId]))[0].name;
  ok("hours: a manager opens one person's month", ((await a.locator("h2").allTextContents()).join("|")).includes(`המשמרות של ${agentName}`));
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
  await a.goto(`${BASE}/hours?user=${agentId}&month=${lastKey}`);
  ok("hours: last month", ((await a.locator("h2.cal-title").textContent()) ?? "").includes(String(lastMonth.getFullYear())) && param(a, "month") === lastKey);
  for (const d of ["1", "30"]) {
    await a.goto(`${BASE}/dashboard?d=${d}`);
    const on = await a.locator(".seg a.on, .seg a[aria-current]").first().getAttribute("href").catch(() => null);
    ok(`dashboard: ${d} days`, !on || on.includes(`d=${d}`), on);
  }
  const proj = (await rows(`SELECT id, name FROM "Project" WHERE active ORDER BY "sortOrder" LIMIT 1`))[0];
  await a.goto(`${BASE}/projects?project=${proj.id}`);
  ok("projects: one project opens", (await a.content()).includes(proj.name) && param(a, "project") === proj.id);
} catch (e) {
  results.push(`CRASH ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
  await db.end();
}
for (const r of results) console.log(r);
if (errors.length) console.log("Page errors:\n" + [...new Set(errors)].join("\n"));
const failed = results.filter((r) => !r.startsWith("PASS")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed || errors.length ? 1 : 0);
