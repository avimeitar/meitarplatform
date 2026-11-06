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

  it("a meeting stands on its own: it works without a lead, and stays when its lead is deleted", async () => {
    const start = new Date(Date.now() + 3 * 86400_000);
    const alone = await prisma.meeting.create({ data: { clientName: "לקוח מפיירברי", subject: "אתונה", startAt: start, place: "", status: "set", setById: by.id } });
    const { result: msg } = await undo.withUndo(by.id, "held", (tx, rec) => crm.setMeetingStatus(tx, rec, alone.id, "held", by));
    expect(msg).toContain("לקוח");
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: alone.id } })).status).toBe("held");
    await undo.withUndo(by.id, "move", (tx, rec) => crm.moveMeeting(tx, rec, alone.id, by, new Date(start.getTime() + 3600_000)));
    await undo.withUndo(by.id, "confirm", (tx, rec) => crm.confirmMeeting(tx, rec, alone.id, by, true));
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: alone.id } })).confirmed).toBe(true);

    const { leadId } = await newLead("+972500000109");
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start, place: "זום", direct: true }));
    await prisma.lead.delete({ where: { id: leadId } });
    const kept = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(kept.leadId).toBe(null);
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

  it("a signed deal stays signed when its meeting is marked, moved or a new one is booked", async () => {
    const { leadId } = await newLead("+972500000201");
    const start = new Date(Date.now() + 2 * 86400_000);
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start, place: "זום", direct: true }));
    await undo.withUndo(by.id, "won", (tx, rec) => crm.setLeadStatus(tx, rec, leadId, "won", by.id));
    const closedAt = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).closedAt;
    expect(closedAt).toBeTruthy();
    await undo.withUndo(by.id, "held", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, "held", by));
    await undo.withUndo(by.id, "move", (tx, rec) => crm.moveMeeting(tx, rec, m.id, by, new Date(start.getTime() + 3600_000)));
    await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start: new Date(start.getTime() + 86400_000), place: "זום", direct: true }));
    await undo.withUndo(by.id, "cancel", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, "cancel", by));
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(l.status).toBe("won");
    expect(l.closedAt?.getTime()).toBe(closedAt?.getTime());
    expect(await prisma.task.count({ where: { leadId, done: false, auto: { not: null } } })).toBe(0);
  });

  it("an answered call starts the count again, and a lead with a meeting doesn't become ״אין מענה״ by itself", async () => {
    const { leadId } = await newLead("+972500000202");
    await undo.withUndo(by.id, "miss", (tx, rec) => crm.logNoAnswer(tx, rec, leadId, by));
    await undo.withUndo(by.id, "miss", (tx, rec) => crm.logNoAnswer(tx, rec, leadId, by));
    await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start: new Date(Date.now() + 2 * 86400_000), place: "זום", direct: false }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).attempts).toBe(0);
    for (let i = 0; i < 3; i++) await undo.withUndo(by.id, "miss", (tx, rec) => crm.logNoAnswer(tx, rec, leadId, by));
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(l.status).toBe("meet");
    expect(l.attempts).toBe(3);
  });

  it("only the newest reminder stays open, and after three tries the next one is the next working day", async () => {
    const { leadId } = await newLead("+972500000203");
    for (let i = 0; i < 3; i++) await undo.withUndo(by.id, "miss", (tx, rec) => crm.logNoAnswer(tx, rec, leadId, by));
    const open = await prisma.task.findMany({ where: { leadId, done: false } });
    expect(open).toHaveLength(1);
    expect(open[0].dueAt.getHours()).toBe(10);
    expect(open[0].dueAt.getTime()).toBeGreaterThan(Date.now() + 3 * 3600_000);
    await undo.withUndo(by.id, "callback", (tx, rec) => crm.logCallback(tx, rec, leadId, by, new Date(Date.now() + 86400_000), "מחר"));
    const after = await prisma.task.findMany({ where: { leadId, done: false } });
    expect(after.map((t) => t.auto)).toEqual(["callback"]);
  });

  it("marking a lead not relevant cancels its future meetings", async () => {
    const { leadId } = await newLead("+972500000204");
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start: new Date(Date.now() + 2 * 86400_000), place: "זום", direct: true }));
    const { result: msg } = await undo.withUndo(by.id, "lost", (tx, rec) => crm.logLost(tx, rec, leadId, by, "אין עניין", true));
    expect(msg).toContain("בוטלה");
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("cancel");
  });

  it("an open lead with no date to come back to stays in the queue", async () => {
    const { leadId } = await newLead("+972500000205");
    await undo.withUndo(by.id, "process", (tx, rec) => crm.setLeadStatus(tx, rec, leadId, "process", by.id));
    await prisma.lead.update({ where: { id: leadId }, data: { nextAt: null } });
    const q = await crm.buildQueue(by.id);
    expect(q.some((x) => x.leadId === leadId)).toBe(true);
  });

  it("on Thursday the queue asks to confirm Friday's meetings too", async () => {
    const { leadId } = await newLead("+972500000206");
    const thu = new Date(2030, 4, 2, 9, 0); // Thursday 2.5.2030
    const fri = new Date(2030, 4, 3, 10, 0);
    expect(thu.getDay()).toBe(4);
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start: fri, place: "משרד, פתח תקווה", direct: true }));
    const q = await crm.buildQueue(by.id, thu);
    expect(q.find((x) => x.meetingId === m.id)?.why).toContain("מחר");
  });

  it("a lead that comes back after its agent left goes to someone active, and automatic handing out is even", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { key: "agent" } });
    const gone = await prisma.user.create({ data: { id: "u-gone", name: "סוכן שעזב", email: "gone@users.meitar.invalid", roleId: role.id, active: false } });
    const second = await prisma.user.create({ data: { id: "u-second", name: "סוכנת שנייה", email: "second@users.meitar.invalid", roleId: role.id, autoAssign: true } });
    const { leadId } = await newLead("+972500000207");
    await prisma.lead.update({ where: { id: leadId }, data: { ownerId: gone.id } });
    await undo.withUndo(by.id, "lost", (tx, rec) => crm.logLost(tx, rec, leadId, by, "אין עניין", false));
    await newLead("+972500000207");
    const back = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(back.status).toBe("new");
    expect([by.id, second.id]).toContain(back.ownerId);
    const picks = await prisma.$transaction(async (tx) => {
      const pick = await crm.autoOwnerPicker(tx);
      return Array.from({ length: 20 }, () => pick());
    });
    const n = (id: string) => picks.filter((p) => p === id).length;
    expect(Math.abs(n(by.id) - n(second.id))).toBeLessThanOrEqual(Math.abs((await prisma.lead.count({ where: { ownerId: by.id } })) - (await prisma.lead.count({ where: { ownerId: second.id } }))) + 20);
    expect(n(second.id)).toBeGreaterThan(0);
  });

  it("only the person who made a change can undo it", async () => {
    const { leadId } = await newLead("+972500000105");
    const { undoId } = await undo.withUndo(by.id, "note", (tx, rec) => crm.addActivity(tx, rec, leadId, { kind: "note", text: "x" }));
    expect((await undo.undo("someone-else", undoId as string)).ok).toBe(false);
  });
});
