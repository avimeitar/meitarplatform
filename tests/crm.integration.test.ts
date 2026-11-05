// Runs against a real PostgreSQL database: TEST_DATABASE_URL=... npm test
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("CRM rules on a real database", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let crm: typeof import("@/lib/crm/service");
  let undo: typeof import("@/lib/undo");
  let by: { id: string; name: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/db"));
    crm = await import("@/lib/crm/service");
    undo = await import("@/lib/undo");
    await prisma.$executeRawUnsafe('TRUNCATE "Lead", "Activity", "Meeting", "Task", "Inquiry", "ActionLog", "session", "account", "user", "Role" CASCADE');
    const role = await prisma.role.create({ data: { key: "agent", name: "סוכן", permissions: ["leads.view_all", "leads.create", "leads.edit"] } });
    const u = await prisma.user.create({ data: { id: "u-test", name: "סוכנת בדיקה", email: "t@users.meitar.invalid", roleId: role.id, autoAssign: true } });
    by = { id: u.id, name: u.name };
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function newLead(phone: string) {
    const { result } = await undo.withUndo(by.id, "test", (tx, rec) => crm.createOrMergeLead(tx, rec, { name: "ליד בדיקה", phone, source: "פייסבוק", owner: "auto" }, null));
    return result;
  }

  it("a second inquiry from the same phone joins the existing lead", async () => {
    const a = await newLead("+972500000101");
    const b = await newLead("+972500000101");
    expect(b.duplicate).toBe(true);
    expect(b.leadId).toBe(a.leadId);
    expect(await prisma.inquiry.count({ where: { leadId: a.leadId } })).toBe(2);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.leadId } })).ownerId).toBe(by.id);
  });

  it("three calls without an answer move the lead to ״אין מענה״ with retry tasks", async () => {
    const { leadId } = await newLead("+972500000102");
    for (let i = 0; i < 3; i++) await undo.withUndo(by.id, "noans", (tx, rec) => crm.logNoAnswer(tx, rec, leadId, by));
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(l.attempts).toBe(3);
    expect(l.status).toBe("noans");
    expect(await prisma.task.count({ where: { leadId, auto: "retry" } })).toBe(3);
  });

  it("a cancelled meeting asks to reschedule, and reversing it removes that task", async () => {
    const { leadId } = await newLead("+972500000103");
    const start = new Date(Date.now() + 2 * 86400_000);
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start, place: "זום", direct: true }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("meet");
    await undo.withUndo(by.id, "cancel", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, "cancel", by));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("resched");
    expect(await prisma.task.count({ where: { leadId, auto: "resched", done: false } })).toBe(1);
    await undo.withUndo(by.id, "set", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, "set", by));
    expect(await prisma.task.count({ where: { leadId, auto: "resched", done: false } })).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("meet");
  });

  it("undo puts everything back: the meeting, the status and the timeline", async () => {
    const { leadId } = await newLead("+972500000104");
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { _count: { select: { activities: true } } } });
    const { undoId } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start: new Date(Date.now() + 86400_000), place: "זום", direct: false }));
    expect(undoId).toBeTruthy();
    const r = await undo.undo(by.id, undoId as string);
    expect(r.ok).toBe(true);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { _count: { select: { activities: true } } } });
    expect(after.status).toBe(before.status);
    expect(after._count.activities).toBe(before._count.activities);
    expect(await prisma.meeting.count({ where: { leadId } })).toBe(0);
    expect((await undo.undo(by.id, undoId as string)).ok).toBe(false);
  });

  it("only the person who made a change can undo it", async () => {
    const { leadId } = await newLead("+972500000105");
    const { undoId } = await undo.withUndo(by.id, "note", (tx, rec) => crm.addActivity(tx, rec, leadId, { kind: "note", text: "x" }));
    expect((await undo.undo("someone-else", undoId as string)).ok).toBe(false);
  });
});
