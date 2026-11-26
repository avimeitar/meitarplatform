// Runs against a real PostgreSQL database: TEST_DATABASE_URL=... npm test
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    await prisma.$executeRawUnsafe('TRUNCATE "Lead", "Activity", "Meeting", "Task", "Inquiry", "ActionLog", "PushSubscription", "ArchiveRecord", "ArchiveBatch", "MetaForm", "MetaPage", "MetaInvite", "SourceCode", "session", "account", "user", "Role" CASCADE');
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

  it("performance counts what each rep received, called, booked and held, and where the leads stand", async () => {
    const perf = await import("@/lib/crm/performance");
    const SRC = "בדיקת ביצועים";
    const lead = async (phone: string) =>
      (await undo.withUndo(by.id, "test", (tx, rec) => crm.createOrMergeLead(tx, rec, { name: "ליד ביצועים", phone, source: SRC, owner: by.id }, null))).result.leadId;
    const a = await lead("+972500000301"); // called, no answer
    const b = await lead("+972500000302"); // booked on the call, and held
    const c = await lead("+972500000303"); // booked, then cancelled
    await lead("+972500000304"); // nobody touched it yet
    const e = await lead("+972500000305"); // wrong number
    await undo.withUndo(by.id, "noans", (tx, rec) => crm.logNoAnswer(tx, rec, a, by));
    const past = new Date(Date.now() - 60_000);
    const { result: mb } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, b, by, { start: past, place: "זום", direct: false }));
    await undo.withUndo(by.id, "held", (tx, rec) => crm.setMeetingStatus(tx, rec, mb.id, "held", by));
    const { result: mc } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, c, by, { start: past, place: "זום", direct: false }));
    await undo.withUndo(by.id, "cancel", (tx, rec) => crm.setMeetingStatus(tx, rec, mc.id, "cancel", by));
    await undo.withUndo(by.id, "lost", (tx, rec) => crm.logLost(tx, rec, e, by, "מספר לא תקין", true));

    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const r = await perf.performance(perf.periodOf({ p: "custom", from: day, to: day }), { projectId: null, source: SRC, repId: null });
    expect(r.tiles.leads).toBe(5);
    expect(r.mix).toMatchObject({ untreated: 1, unreached: 1, junk: 1, relevant: 2, met: 2, held: 1 });
    // relevant out of those we could judge: 2 relevant, 1 wrong number
    expect(r.tiles.relevantPct).toBe(67);
    expect(r.tiles).toMatchObject({ set: 2, held: 1, canceled: 1, showUpPct: 50 });
    expect(r.funnel).toEqual([5, 2, 2, 1, 0]);
    const me = r.reps.find((x) => x.id === by.id);
    expect(me).toMatchObject({ received: 5, untouched: 1, set: 2, held: 1, canceled: 1, showUpPct: 50 });
    // three answered calls (two bookings and the wrong number) and one without an answer
    expect(me?.calls).toBe(4);
    expect(me?.answered).toBe(3);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ key: SRC, leads: 5, won: 0, topReason: "מספר לא תקין" });
  });

  it("a no-show sends the lead back to ״לתאם מחדש״ with a task, like a cancelled meeting", async () => {
    const { leadId } = await newLead("+972500000401");
    const start = new Date(Date.now() - 3600_000);
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start, place: "משרד, פתח תקווה", direct: true }));
    const msg = (await undo.withUndo(by.id, "noshow", (tx, rec) => crm.setMeetingStatus(tx, rec, m.id, "noshow", by))).result;
    expect(msg).toContain("אי-הגעה");
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("noshow");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("resched");
    expect(await prisma.task.count({ where: { leadId, auto: "resched", done: false } })).toBe(1);
  });

  it("booking a meeting with someone else moves the client to them; the booker stays as the one who set it", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { key: "agent" } });
    const closer = await prisma.user.create({ data: { id: "u-closer", name: "דרור בדיקה", email: "closer@users.meitar.invalid", roleId: role.id } });
    const { leadId } = await newLead("+972500000402");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).ownerId).not.toBe(closer.id);
    const start = new Date(Date.now() + 86400_000);
    const { result: m } = await undo.withUndo(by.id, "book", (tx, rec) => crm.bookMeeting(tx, rec, leadId, by, { start, place: "משרד, פתח תקווה", direct: true, hostId: closer.id }));
    expect(m.setById).toBe(by.id);
    expect(m.hostId).toBe(closer.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).ownerId).toBe(closer.id);
    expect(await prisma.leadAssignment.count({ where: { leadId, userId: closer.id } })).toBe(1);
  });

  it("a task can be in progress or cancelled; cancelled closes it without counting as done", async () => {
    const { leadId } = await newLead("+972500000501");
    const { result: t } = await undo.withUndo(by.id, "task", (tx, rec) => crm.addTask(tx, rec, { leadId, userId: by.id, title: "לשלוח הצעת מחיר", dueAt: new Date(Date.now() + 3600_000), createdById: by.id }));
    const { taskState } = await import("@/lib/crm/constants");
    await undo.withUndo(by.id, "progress", (tx, rec) => crm.setTaskState(tx, rec, t.id, "progress", by));
    let row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(taskState(row)).toBe("progress");
    expect(row.done).toBe(false);
    await undo.withUndo(by.id, "cancel", (tx, rec) => crm.setTaskState(tx, rec, t.id, "cancel", by));
    row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(taskState(row)).toBe("cancel");
    expect(row.done && row.voided).toBe(true);
    await undo.withUndo(by.id, "open", (tx, rec) => crm.setTaskState(tx, rec, t.id, "open", by));
    row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(taskState(row)).toBe("open");
    await undo.withUndo(by.id, "done", (tx, rec) => crm.setTaskState(tx, rec, t.id, "done", by));
    expect(taskState(await prisma.task.findUniqueOrThrow({ where: { id: t.id } }))).toBe("done");
  });

  it("a phone reminder goes out once per due task, only to people who turned reminders on", async () => {
    const push = await import("@/lib/push");
    const now = new Date();
    const mk = (title: string, userId: string, minutesAgo: number, auto: string | null = null) =>
      prisma.task.create({ data: { userId, title, dueAt: new Date(now.getTime() - minutesAgo * 60_000), auto } });
    const due = await mk("לחזור ללקוח", by.id, 5);
    const retry = await mk("לנסות שוב", by.id, 5, "retry");
    const old = await mk("ישנה", by.id, 300);
    const role = await prisma.role.findFirstOrThrow({ where: { key: "agent" } });
    const other = await prisma.user.create({ data: { id: "u-nopush", name: "בלי התראות", email: "nopush@users.meitar.invalid", roleId: role.id } });
    const theirs = await mk("של מישהו אחר", other.id, 5);
    // nobody has reminders on yet: nothing is claimed
    expect((await push.claimDueTasks(now)).length).toBe(0);
    await prisma.pushSubscription.create({ data: { userId: by.id, endpoint: "https://fcm.googleapis.com/fcm/send/test-" + Date.now(), p256dh: "x".repeat(20), auth: "y".repeat(8) } });
    const first = (await push.claimDueTasks(now)).map((t) => t.id);
    expect(first).toContain(due.id);
    expect(first).not.toContain(retry.id);
    expect(first).not.toContain(old.id);
    expect(first).not.toContain(theirs.id);
    // the second minute: already reminded
    expect((await push.claimDueTasks(now)).map((t) => t.id)).not.toContain(due.id);
    expect(push.isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(push.isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(push.isPushEndpoint("https://evil.example.com/abc")).toBe(false);
    expect(push.isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
  });

  it("a supplier's personal link: the key in the address, a lead by GET or POST, and a check that saves nothing", async () => {
    const route = await import("@/app/api/v1/leads/route");
    const { generateApiKey } = await import("@/lib/intake");
    const g = generateApiKey();
    await prisma.apiKey.create({ data: { name: "ספק בדיקה", prefix: g.prefix, hash: g.hash, source: "ספק בדיקה" } });
    const link = `http://localhost/api/v1/leads?key=${g.key}`;
    const before = await prisma.lead.count();
    // the link alone, as when opened in a browser or previewed in WhatsApp: it works, and nothing is saved
    const check = await route.GET(new Request(link));
    expect(check.status).toBe(200);
    expect((await check.json()).check).toBe(true);
    expect((await route.HEAD()).status).toBe(204);
    expect(await prisma.lead.count()).toBe(before);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { prefix: g.prefix } })).lastUsedAt).toBeNull();
    // a lead in the address
    const byGet = await route.GET(new Request(`${link}&name=${encodeURIComponent("דנה כהן")}&phone=050-000-0901`));
    expect(byGet.status).toBe(201);
    const got = await prisma.lead.findFirstOrThrow({ where: { phone: "+972500000901" }, include: { inquiries: true } });
    expect(got.name).toBe("דנה כהן");
    expect(got.source).toBe("ספק בדיקה");
    // the key is not kept with what was sent
    expect(JSON.stringify(got.inquiries[0]?.payload ?? {})).not.toContain(g.key);
    // a post with the key in the address and the lead in the body
    const byPost = await route.POST(new Request(link, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "רון לוי", phone: "0500000902" }) }));
    expect(byPost.status).toBe(201);
    // a post with nothing in the body and the fields in the address
    const empty = await route.POST(new Request(`${link}&phone=0500000903`, { method: "POST" }));
    expect(empty.status).toBe(201);
    // the same phone again: added to the client that exists
    expect((await route.GET(new Request(`${link}&phone=0500000901`))).status).toBe(200);
    // a wrong key, or none
    expect((await route.GET(new Request(`http://localhost/api/v1/leads?key=${g.key.slice(0, -2)}xx&phone=0500000904`))).status).toBe(401);
    expect((await route.GET(new Request("http://localhost/api/v1/leads?phone=0500000904"))).status).toBe(401);
    expect(await prisma.lead.count({ where: { phone: "+972500000904" } })).toBe(0);
  });

  it("only the person who made a change can undo it", async () => {
    const { leadId } = await newLead("+972500000105");
    const { undoId } = await undo.withUndo(by.id, "note", (tx, rec) => crm.addActivity(tx, rec, leadId, { kind: "note", text: "x" }));
    expect((await undo.undo("someone-else", undoId as string)).ok).toBe(false);
  });

  it("a supplier who sent leads to Fireberry changes only the address: the source number gets its name, before or after", async () => {
    const route = await import("@/app/api/v1/leads/route");
    const codes = await import("@/lib/sourceCodes");
    const { generateApiKey } = await import("@/lib/intake");
    const g = generateApiKey();
    await prisma.apiKey.create({ data: { name: "דבוש", prefix: g.prefix, hash: g.hash, source: "דבוש" } });
    const project = await prisma.project.create({ data: { name: `מטרו רעננה ${Date.now() % 1_000_000}`, fullName: "מטרו רעננה", place: "" } });
    // exactly what the supplier sent to Fireberry (webtoaccount.aspx), as a form
    const send = (phone: string, code: string) =>
      route.POST(
        new Request(`http://localhost/api/v1/leads?key=${g.key}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ uid: "BC4E2C45-26D7-465A-A8CA-076757A95783", statuscode: "9", originatingleadcode: code, telephone1: phone, accountname: "בדיקה מספק" }).toString(),
        }),
      );
    // a number nobody named yet: the lead still comes in, marked with the number
    expect((await send("972500000961", "138")).status).toBe(201);
    const first = await prisma.lead.findUniqueOrThrow({ where: { phone: "+972500000961" } });
    expect(first.name).toBe("בדיקה מספק");
    expect(first.source).toBe("דבוש (קוד 138)");
    expect((await prisma.sourceCode.findUniqueOrThrow({ where: { code: "138" } })).seen).toBe(1);
    // the manager names it: the lead that came takes the name and the project
    expect(await codes.nameSourceCode("138", "מטרו רעננה - דבוש", project.id)).toBe(1);
    const renamed = await prisma.lead.findUniqueOrThrow({ where: { id: first.id }, include: { inquiries: true } });
    expect(renamed.source).toBe("מטרו רעננה - דבוש");
    expect(renamed.projectId).toBe(project.id);
    expect(renamed.inquiries[0].source).toBe("מטרו רעננה - דבוש");
    // the next lead with that number comes in named
    expect((await send("972500000962", "138")).status).toBe(201);
    const next = await prisma.lead.findUniqueOrThrow({ where: { phone: "+972500000962" } });
    expect(next.source).toBe("מטרו רעננה - דבוש");
    expect(next.projectId).toBe(project.id);
  });

  it("Facebook Lead Ads: a lead from the webhook comes in once, a supplier's page keeps its source, and a form's leads can be pulled", async () => {
    process.env.BETTER_AUTH_SECRET ||= "test-secret-for-meta-0123456789";
    process.env.META_APP_ID = "1234";
    process.env.META_APP_SECRET = "app-secret";
    const meta = await import("@/lib/meta");
    const leads = await import("@/lib/metaLeads");
    const webhook = await import("@/app/api/meta/webhook/route");
    const t = Date.now() % 1_000_000;
    const project = await prisma.project.create({ data: { name: `חדרה מטא ${t}`, fullName: "חדרה", place: "" } });
    const supplierProject = await prisma.project.create({ data: { name: `אתונה מטא ${t}`, fullName: "אתונה", place: "" } });
    await prisma.metaPage.create({ data: { id: "111", name: "מיתר", token: meta.sealToken("PAGE-TOKEN-1") } });
    await prisma.metaPage.create({ data: { id: "222", name: "עמוד של ספק", token: meta.sealToken("PAGE-TOKEN-2"), supplier: "צביקה", source: "צביקה - פייסבוק", projectId: supplierProject.id } });
    const answers = (phone: string, name: string) => [
      { name: "full_name", values: [name] },
      { name: "phone_number", values: [phone] },
    ];
    const graph: Record<string, unknown> = {
      "9001": { id: "9001", form_id: "555", created_time: "2026-11-24T08:00:00+0000", field_data: answers("+972500000951", "דנה מפייסבוק"), campaign_name: "חדרה סתיו", platform: "fb" },
      "9002": { id: "9002", form_id: "666", created_time: "2026-11-24T08:05:00+0000", field_data: answers("+972500000952", "רון מספק"), platform: "fb" },
      "555": { name: "טופס חדרה" },
      "666": { name: "טופס הספק" },
      "111/leadgen_forms": { data: [{ id: "555", name: "טופס חדרה" }] },
      "555/leads": {
        data: [
          { id: "9001", form_id: "555", created_time: "2026-11-24T08:00:00+0000", field_data: answers("+972500000951", "דנה מפייסבוק"), platform: "fb" },
          { id: "9003", form_id: "555", created_time: "2026-11-24T09:00:00+0000", field_data: answers("+972500000953", "נועה מאינסטגרם"), platform: "ig" },
        ],
      },
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      // every call is signed with the page token's proof
      if (!url.searchParams.get("appsecret_proof")) return new Response(JSON.stringify({ error: { message: "no proof" } }), { status: 400 });
      const key = url.pathname.replace(/^\/v\d+\.\d+\//, "");
      const body = graph[key];
      return body ? new Response(JSON.stringify(body)) : new Response(JSON.stringify({ error: { message: `unknown ${key}`, code: 100 } }), { status: 400 });
    });
    const deliver = async (pageId: string, leadgenId: string, secret = "app-secret") => {
      const raw = JSON.stringify({ object: "page", entry: [{ id: pageId, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "555", created_time: 1 } }] }] });
      const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
      return webhook.POST(new Request("http://localhost/api/meta/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } }));
    };
    try {
      // Meta checks the address with the verify word
      const check = await webhook.GET(new Request(`http://localhost/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${meta.metaVerifyToken()}&hub.challenge=abc`));
      expect(await check.text()).toBe("abc");
      expect((await webhook.GET(new Request("http://localhost/api/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc"))).status).toBe(403);
      // a delivery signed with another secret is turned away
      expect((await deliver("111", "9001", "not-the-secret")).status).toBe(401);
      // a lead from our page: in, with Facebook as the source and the campaign
      expect((await deliver("111", "9001")).status).toBe(200);
      const dana = await prisma.lead.findUniqueOrThrow({ where: { phone: "+972500000951" }, include: { inquiries: true } });
      expect(dana.name).toBe("דנה מפייסבוק");
      expect(dana.source).toBe("פייסבוק");
      expect(dana.inquiries[0].campaign).toBe("חדרה סתיו");
      expect(dana.inquiries[0].page).toBe("טופס חדרה");
      expect((await prisma.metaForm.findUniqueOrThrow({ where: { id: "555" } })).name).toBe("טופס חדרה");
      // the same lead again (Meta retries, or the safety net): still one inquiry
      expect((await deliver("111", "9001")).status).toBe(200);
      expect(await prisma.inquiry.count({ where: { leadId: dana.id } })).toBe(1);
      // a supplier's page: the supplier's source and project
      expect((await deliver("222", "9002")).status).toBe(200);
      const ron = await prisma.lead.findUniqueOrThrow({ where: { phone: "+972500000952" } });
      expect(ron.source).toBe("צביקה - פייסבוק");
      expect(ron.projectId).toBe(supplierProject.id);
      // a page that is not connected: nothing happens
      expect((await deliver("333", "9009")).status).toBe(200);
      // the form goes to a project, and pulling brings what the webhook missed (from Instagram), once
      await prisma.metaForm.update({ where: { id: "555" }, data: { projectId: project.id } });
      const page = await prisma.metaPage.findUniqueOrThrow({ where: { id: "111" } });
      const pulled = await leads.pullPage(meta.metaConfig()!, page, new Date(Date.now() - 86_400_000));
      expect(pulled).toEqual({ created: 1, merged: 0, forms: 1 });
      const noa = await prisma.lead.findUniqueOrThrow({ where: { phone: "+972500000953" } });
      expect(noa.source).toBe("אינסטגרם");
      expect(noa.projectId).toBe(project.id);
      expect((await prisma.metaForm.findUniqueOrThrow({ where: { id: "555" } })).leads).toBe(2);
      expect(calls.some((c) => c.endsWith("/555/leads"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // last: it empties the working system
  it("the archive: everything moves with its history, the chosen projects stay empty, and nothing is lost", async () => {
    const archive = await import("@/lib/archive");
    const t = Date.now() % 1_000_000;
    const keep = await prisma.project.create({ data: { name: `חדרה ${t}`, fullName: "חדרה", place: "" } });
    const leave = await prisma.project.create({ data: { name: `אתונה ${t}`, fullName: "אתונה", place: "" } });
    const key = await prisma.apiKey.create({ data: { name: "ספק", prefix: `ar${t}`, hash: "x".repeat(64), source: "ספק", projectId: leave.id } });
    const { leadId } = await newLead("+972500000801");
    await prisma.lead.update({ where: { id: leadId }, data: { projectId: keep.id } });
    await undo.withUndo(by.id, "note", (tx, rec) => crm.addActivity(tx, rec, leadId, { kind: "note", text: "הערה לארכיון" }));
    await prisma.meeting.create({ data: { leadId, startAt: new Date(), place: "משרד", projectId: leave.id, setById: by.id } });
    await prisma.task.create({ data: { leadId, userId: by.id, title: "לחזור", dueAt: new Date() } });
    await prisma.meeting.create({ data: { clientName: "מפיירברי", startAt: new Date(), place: "משרד", repName: "נציג" } });
    await prisma.task.create({ data: { userId: by.id, title: "משימה בלי לקוח", dueAt: new Date() } });
    const before = { leads: await prisma.lead.count(), meetings: await prisma.meeting.count(), tasks: await prisma.task.count(), projects: await prisma.project.count() };

    // the preview counts what would move
    const preview = await archive.archivePreview([keep.id]);
    expect(preview).toEqual({ leads: before.leads, meetings: before.meetings, tasks: before.tasks, projects: before.projects - 1 });

    const r = await archive.archiveAll(by, [keep.id]);
    expect(r.counts).toEqual(preview);
    expect(r.kept).toEqual([keep.name]);
    // the working system is clean, and the kept project is still there
    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.meeting.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
    expect((await prisma.project.findMany()).map((p) => p.id)).toEqual([keep.id]);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).projectId).toBeNull();
    // every record is in the archive, a client with its whole story
    const records = await prisma.archiveRecord.findMany({ where: { batchId: r.batchId } });
    expect(records.filter((x) => x.kind === "lead").length).toBe(before.leads);
    const client = records.find((x) => x.originalId === leadId)!;
    expect(client.project).toBe(keep.name);
    const data = client.data as { activities: { text: string }[]; meetings: { project: string }[]; tasks: { title: string }[] };
    expect(data.activities.some((a) => a.text === "הערה לארכיון")).toBe(true);
    expect(data.meetings[0].project).toBe(leave.name);
    expect(data.tasks[0].title).toBe("לחזור");
    expect(records.some((x) => x.kind === "meeting" && x.name === "מפיירברי" && x.owner === "נציג")).toBe(true);
    expect(records.some((x) => x.kind === "task" && x.name === "משימה בלי לקוח")).toBe(true);
    expect(records.some((x) => x.kind === "project" && x.name === leave.name)).toBe(true);
    // every meeting and task is found on its own too, the client's ones pointing back to the client
    expect(records.filter((x) => x.kind === "meeting").length).toBe(before.meetings);
    expect(records.filter((x) => x.kind === "task").length).toBe(before.tasks);
    const clientTask = records.find((x) => x.kind === "task" && x.name === "לחזור")!;
    expect((clientTask.data as { clientId: string }).clientId).toBe(leadId);
    // the same client comes back: a new client, and the archive still knows the old one
    expect((await archive.archivedClient("+972500000801"))?.id).toBe(client.id);
    expect((await newLead("+972500000801")).duplicate).toBe(false);
  });
});
