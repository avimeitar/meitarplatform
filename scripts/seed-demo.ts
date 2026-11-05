// Fills an EMPTY database with fake demo data (for local development or a staging copy).
// Usage: npx tsx scripts/seed-demo.ts --yes
// It refuses to run when the database already has leads, so it can never mix with real data.
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { ensureBaseData } from "../src/lib/bootstrap";
import { addDays, at, sod } from "../src/lib/crm/dates";
import { createUserRecord, setUserPassword } from "../src/lib/users";

const FIRST = ["נועה", "יוסי", "מיכל", "דניאל", "שירה", "אבי", "רונית", "עומר", "גלית", "איתי", "הילה", "משה", "תמר", "אריאל", "סיגל", "יעל", "רועי", "ליאת", "חיים", "ענבל", "אורית", "דוד", "נעמה", "אלון"];
const LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "דהן", "אזולאי", "שפירא", "גבאי", "חזן", "יוסף", "עמר", "סויסה", "אוחיון", "קליין", "רוזן", "בן דוד", "טל"];
const SOURCES = ["פייסבוק", "דף נחיתה", "גוגל", "ספק לידים", "וואטסאפ", "הפניה", "אתר החברה", "שיחה נכנסת"];
const STATUSES = ["new", "process", "noans", "meet", "resched", "held", "follow", "won", "lost"];

let seed = 20261105;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

async function main() {
  if (!process.argv.includes("--yes")) throw new Error("Pass --yes to confirm you want fake demo data");
  if ((await prisma.lead.count()) > 0) throw new Error("This database already has leads. The demo seed only runs on an empty database.");
  await ensureBaseData();
  const agentRole = await prisma.role.findUniqueOrThrow({ where: { key: "agent" } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: "manager" } });
  const team: { id: string; name: string }[] = [];
  for (const [name, phone, role] of [
    ["אורנה דוגמה", "050-0000011", agentRole.id],
    ["אולה דוגמה", "050-0000012", agentRole.id],
    ["דרור דוגמה", "050-0000013", managerRole.id],
  ] as const) {
    const existing = await prisma.user.findFirst({ where: { name } });
    const u = existing ?? (await createUserRecord({ name, phone: "+972" + phone.replace(/\D/g, "").slice(1), roleId: role }));
    if (!existing) {
      await setUserPassword(u.id, "demo-pass-1234");
      await prisma.user.update({ where: { id: u.id }, data: { autoAssign: role === agentRole.id } });
    }
    team.push({ id: u.id, name: u.name });
  }
  const agents = team.slice(0, 2);
  const projects = await prisma.project.findMany();
  const now = new Date();
  const used = new Set<string>();
  for (let i = 0; i < 160; i++) {
    let name = "";
    for (let t = 0; t < 20 && (!name || used.has(name)); t++) name = `${pick(FIRST)} ${pick(LAST)}`;
    used.add(name);
    const age = Math.floor(Math.pow(rnd(), 1.4) * 120);
    const created = at(addDays(sod(now), -age), 8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
    if (created > now) created.setTime(now.getTime() - 3600_000);
    const status = age < 1 ? "new" : pick(STATUSES);
    const owner = rnd() < 0.08 ? null : pick(agents);
    const proj = pick(projects);
    const lead = await prisma.lead.create({
      data: {
        name,
        phone: "+97250" + String(1000000 + i * 37).slice(0, 7),
        source: pick(SOURCES),
        projectId: proj.id,
        status,
        lostReason: status === "lost" ? pick(["לא מעוניין", "אין תקציב", "מספר לא תקין"]) : null,
        ownerId: owner?.id ?? null,
        attempts: status === "noans" ? 3 : 0,
        nextAt: ["process", "noans", "follow", "resched", "held"].includes(status) ? at(addDays(sod(now), Math.floor(rnd() * 4) - 1), 10 + Math.floor(rnd() * 7)) : null,
        closedAt: status === "won" ? addDays(created, 10 + Math.floor(rnd() * 30)) : null,
        createdAt: created,
        lastActivityAt: created,
        activities: { create: [{ kind: "in", text: "ליד חדש נכנס. מקור: דוגמה", createdAt: created }] },
      },
    });
    if (["meet", "held", "follow", "won", "resched"].includes(status)) {
      const start = status === "meet" ? at(addDays(sod(now), Math.floor(rnd() * 5)), 10 + Math.floor(rnd() * 8)) : at(addDays(sod(now), -1 - Math.floor(rnd() * 20)), 10 + Math.floor(rnd() * 8));
      await prisma.meeting.create({
        data: { id: randomUUID(), leadId: lead.id, projectId: proj.id, startAt: start, place: "משרד, פתח תקווה", status: status === "meet" ? "set" : status === "resched" ? "cancel" : "held", setById: owner?.id ?? agents[0].id, hostId: team[2].id },
      });
    }
    if (owner && rnd() < 0.3) await prisma.task.create({ data: { leadId: lead.id, userId: owner.id, title: `לחזור ל${name}`, dueAt: at(addDays(sod(now), Math.floor(rnd() * 3) - 1), 11) } });
  }
  console.log("Demo data ready: 160 fake leads, 2 agents and a sales manager (password demo-pass-1234).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
