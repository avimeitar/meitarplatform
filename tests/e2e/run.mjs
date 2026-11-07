// End-to-end check in a real browser, against a running dev server with demo data.
//   1. npx tsx scripts/seed-demo.ts --yes      (empty database only)
//   2. npm run dev > /tmp/dev.log 2>&1 &        (OTP codes are read from this log)
//   3. DEVLOG=/tmp/dev.log ADMIN_PHONE=... ADMIN_PASS=... npm run e2e
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const LOG = process.env.DEVLOG;
const ADMIN = [process.env.ADMIN_PHONE || "050-0000001", process.env.ADMIN_PASS || "test-pass-1234"];
const AGENT = [process.env.AGENT_PHONE || "050-0000011", process.env.AGENT_PASS || "demo-pass-1234"];
if (!LOG) throw new Error("Set DEVLOG to the dev server's log file");

const results = [];
const ok = (name, cond, info) => results.push(`${cond ? "PASS" : "FAIL"} ${name}${info !== undefined ? `  [${String(info).slice(0, 120)}]` : ""}`);
const lastCode = () => {
  const m = [...fs.readFileSync(LOG, "utf8").matchAll(/\[otp\] (?:login|reset) code for \S+ by \w+: (\d{6})/g)];
  return m.length ? m[m.length - 1][1] : null;
};
const toast = async (p) => {
  await p.waitForTimeout(900);
  return (await p.locator(".toast span").textContent().catch(() => "")) || "";
};
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function login(p, [phone, pass]) {
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=username]", phone);
  await p.fill("input[name=password]", pass);
  await p.click("button[type=submit]");
  // the code step appears only while "code at every sign-in" is on
  await Promise.race([p.waitForURL("**/dashboard", { timeout: 15000 }), p.waitForSelector('h1:has-text("לאן לשלוח"), h1:has-text("מקלידים")', { timeout: 15000 })]).catch(() => {});
  if (p.url().endsWith("/dashboard")) return;
  if (await p.locator('h1:has-text("לאן לשלוח")').count()) await p.click(".opt >> nth=0");
  await p.waitForSelector(".code-input");
  await p.waitForTimeout(400);
  await p.fill(".code-input", lastCode());
  await p.waitForURL("**/dashboard", { timeout: 20000 });
}

const browser = await chromium.launch();
const errors = [];
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Jerusalem", locale: "he-IL" };
try {
  // ---- sign-in with a code, wrong password and wrong code ----
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: "Asia/Jerusalem" })).newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(`${BASE}/dashboard`);
  ok("signed-out visitors go to sign-in", a.url().includes("/login"));
  await a.fill("input[name=username]", ADMIN[0]);
  await a.fill("input[name=password]", "wrong-password");
  await a.click("button[type=submit]");
  await a.waitForTimeout(1200);
  ok("wrong password is refused", ((await a.locator(".form-error").textContent().catch(() => "")) || "").includes("לא נכונים"));
  await login(a, ADMIN);
  ok("admin signs in", a.url().endsWith("/dashboard"));

  // ---- users: invite, set password, deactivate, delete ----
  const newPhone = "050-" + String(Date.now()).slice(-7);
  await a.goto(`${BASE}/users`);
  await a.click("text=משתמש חדש");
  await a.fill(".drawer input >> nth=0", "סוכן בדיקה");
  await a.fill(".drawer input >> nth=1", newPhone);
  await a.click(".drawer button[type=submit]");
  await a.waitForSelector("text=לשלוח את הקישור בוואטסאפ", { timeout: 10000 });
  const link = (await a.locator(".link-box").textContent()).trim();
  ok("new user gets a one-time link", link.includes("/invite/"));
  await a.keyboard.press("Escape");
  const q = await (await browser.newContext(phone)).newPage();
  q.on("pageerror", (e) => errors.push("agent: " + e.message));
  await q.goto(link);
  await q.fill("input[type=password] >> nth=0", "12345678");
  await q.fill("input[type=password] >> nth=1", "12345678");
  await q.click("button[type=submit]");
  await q.waitForTimeout(600);
  ok("common passwords are refused", !!(await q.locator(".form-error").count()));
  await q.fill("input[type=password] >> nth=0", "agent-pass-5678");
  await q.fill("input[type=password] >> nth=1", "agent-pass-5678");
  await q.click("button[type=submit]");
  await q.waitForURL("**/login**", { timeout: 15000 });
  await q.goto(link);
  ok("the link works only once", (await q.locator("h1").textContent()).includes("לא בתוקף"));
  await login(q, [newPhone, "agent-pass-5678"]);
  await q.goto(`${BASE}/users`);
  // the loading screen streams first, so the redirect to "no access" lands a moment later
  await q.waitForURL("**/denied**", { timeout: 10000 }).catch(() => {});
  ok("agents cannot open the users screen", q.url().includes("/denied"));
  await a.goto(`${BASE}/users`);
  await a.click('.ulist li:has-text("סוכן בדיקה") button:has-text("ניהול")');
  await a.click('.drawer button:has-text("להשבית את החשבון")');
  // deactivating asks first
  await a.click('.drawer button:has-text("כן, להשבית")');
  await a.waitForTimeout(1200);
  await q.goto(`${BASE}/dashboard`);
  ok("deactivating signs the person out at once", q.url().includes("/login"));
  await a.click('.ulist li:has-text("סוכן בדיקה") button:has-text("ניהול")');
  await a.click('.drawer button:has-text("למחוק את המשתמש")');
  await a.selectOption(".drawer select", "auto");
  await a.click('.drawer button:has-text("כן, למחוק")');
  const del = await toast(a);
  ok("deleting hands over the leads", del.includes("נמחק"), del);
  await a.goto(`${BASE}/audit`);
  ok("the audit log records it", (await a.locator("table.audit tbody tr").count()) > 3);

  // ---- the rep's day on a phone ----
  const p = await (await browser.newContext(phone)).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await login(p, AGENT);
  ok("home has no sideways scroll", (await overflow(p)) <= 0);
  await p.goto(`${BASE}/work`);
  if (await p.locator(".work-top").count()) {
    const pos = async () => (await p.locator(".work-top b").textContent()).trim();
    await p.click(".wacts a.bigbtn.call");
    await p.waitForSelector(".drawer .opt");
    ok("after a call: four answers", (await p.locator(".drawer .opt").count()) === 4);
    await p.click('.drawer .opt:has-text("אין מענה")');
    ok("no answer is logged and the queue moves on", (await toast(p)).includes("אין מענה") && (await pos()).startsWith("ליד 2"));
    await p.click(".toast button");
    ok("undo", (await toast(p)).includes("בוטל"));
    await p.click(".wacts a.bigbtn.call");
    await p.waitForSelector(".drawer .opt");
    await p.click('.drawer .opt:has-text("קבענו פגישה")');
    await p.click(".drawer .chips.days button >> nth=1");
    await p.click(".drawer .chips >> nth=1 >> button >> nth=0");
    ok("the save button reads the booking back", (await p.locator(".drawer .sheet-foot .bigbtn").textContent()).startsWith("לקבוע:"));
    await p.click(".drawer .sheet-foot .bigbtn");
    ok("meeting booked", (await toast(p)).includes("נקבעה"));
  } else ok("queue has leads (seed demo data first)", false);
  await p.goto(`${BASE}/leads`);
  ok("agents get five simple views", (await p.locator(".views .view").count()) === 5);
  ok("no multi-select for agents", (await p.locator(".leads input[type=checkbox]").count()) === 0);
  await p.click(".leads tbody tr >> nth=0");
  await p.waitForURL(/\/leads\/[^/?]+$/);
  ok("lead card has no sideways scroll", (await overflow(p)) <= 0);
  await p.click('.metro button:has-text("נחתמה עסקה")');
  await p.waitForSelector(".drawer");
  ok("a signed deal asks first", (await p.locator(".drawer h2").textContent()).includes("לסמן"));
  await p.click('.drawer button:has-text("עוד לא")');
  await p.goto(`${BASE}/meetings`);
  ok("meetings open as a calendar", (await p.locator(".cal").count()) === 1);
  const ev = p.locator(".cal-col.sel .ev, .mev").first();
  if (await ev.count()) {
    await ev.click();
    await p.waitForSelector(".drawer .mdetail", { timeout: 10000 }).catch(() => {});
    ok("a meeting on the calendar opens its details", (await p.locator(".drawer .mdetail .md-kv").count()) === 1);
    await p.keyboard.press("Escape");
  }
  await p.goto(`${BASE}/meetings?view=list`);
  const setRow = p.locator('.mtable tbody tr:has(.mseg button.on.m-set)').first();
  if (await setRow.count()) {
    await setRow.locator('.mseg button:has-text("התקיימה")').click();
    ok("meeting marked held", (await toast(p)).includes("התקיימה"));
  }
  await p.goto(`${BASE}/tasks`);
  const open = p.locator(".tlist li:has(input:not(:checked))").first();
  if (await open.count()) {
    const before = await p.locator(".tlist li").count();
    await open.locator("input").click();
    ok("finishing a task names it", (await toast(p)).startsWith("בוצע:"));
    ok("a finished task stays in place", (await p.locator(".tlist li").count()) === before);
  }
  await p.waitForTimeout(1200);
  await p.click(".top .new-lead");
  await p.fill(".drawer input >> nth=0", "ליד מבדיקה");
  await p.fill(".drawer input >> nth=1", "052-" + String(Date.now()).slice(-7));
  await p.click(".drawer button[type=submit]");
  await p.waitForTimeout(500);
  ok("a new lead needs a project", ((await p.locator(".drawer .err").textContent().catch(() => "")) || "").includes("פרויקט"));
  await p.click(".drawer .pchips label >> nth=0");
  await p.click(".drawer button[type=submit]");
  await p.waitForURL(/\/leads\/[^/?]+$/, { timeout: 10000 });
  ok("the new lead's card opens", (await p.locator(".lead-head h1").textContent()).includes("ליד מבדיקה"));
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push("CRASH " + String(e.message).split("\n")[0]);
} finally {
  await browser.close();
}
console.log(results.join("\n"));
const failed = results.filter((r) => !r.startsWith("PASS")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
