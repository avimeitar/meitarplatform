"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MS, ST } from "@/lib/crm/constants";
import { prisma } from "@/lib/db";
import { fireberryKind, guessMeetingProject, guessProject, leadRowKey, legacyMeetingKey, mapMeetingStatus, mapStatus, meetingKey, parseCsv, readFireberry, readFireberryMeetings, type FbMeeting, type FbRow } from "@/lib/fireberry";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

export type LeadsPreview = {
  kind: "leads";
  files: number;
  total: number;
  valid: number;
  badPhone: number;
  dupInFile: number;
  existing: number;
  /** rows imported before (the same file or another export with the same rows): they are not added again */
  already: number;
  sources: { source: string; count: number; projectId: string }[];
  owners: { name: string; count: number; userId: string }[];
  statuses: { from: string; count: number; to: string }[];
};

export type MeetingsPreview = {
  kind: "meetings";
  files: number;
  total: number;
  /** meetings with a date, each counted once even when it appears in two files */
  valid: number;
  noDate: number;
  dupInFile: number;
  existing: number;
  upcoming: number;
  reps: { name: string; count: number; userId: string }[];
  subjects: { subject: string; count: number; projectId: string }[];
  statuses: { from: string; count: number; to: string }[];
};

export type ImportPreview = LeadsPreview | MeetingsPreview;

const MAX_ROWS = 20000;
const MAX_FILES = 20;
const MAX_CHARS = 15_000_000;
const NO_SUBJECT = "ללא נושא";
const NO_SOURCE = "לא צוין";

type Parsed = { kind: "leads"; rows: FbRow[]; files: number } | { kind: "meetings"; rows: FbMeeting[]; files: number };

/** Reads one or more Fireberry exports. All of them must be of the same kind: leads, or meetings. */
function parseFiles(input: unknown): Parsed {
  const files = (Array.isArray(input) ? input : [input]).map((f) => String(f ?? "")).filter((f) => f.trim());
  if (!files.length) throw new ActionError("לא נבחר קובץ");
  if (files.length > MAX_FILES) throw new ActionError(`אפשר לייבא עד ${MAX_FILES} קבצים בפעם אחת`);
  if (files.reduce((n, f) => n + f.length, 0) > MAX_CHARS) throw new ActionError("הקבצים גדולים מדי. אפשר לייבא אותם בכמה פעמים");
  const kinds = files.map((f) => fireberryKind(parseCsv(f.slice(0, 20_000))[0] ?? []));
  if (kinds.some((k) => !k)) throw new ActionError((files.length > 1 ? "אחד הקבצים לא זוהה. " : "הקובץ לא זוהה. ") + "צריך קובץ ייצוא מפיירברי (CSV) של לידים או של פגישות");
  if (new Set(kinds).size > 1) throw new ActionError("נבחרו גם קובץ של לידים וגם קובץ של פגישות. צריך לייבא כל סוג בנפרד");
  if (kinds[0] === "meetings") {
    const rows = files.flatMap((f) => readFireberryMeetings(f));
    if (rows.length > MAX_ROWS) throw new ActionError(`בקבצים יותר מ-${MAX_ROWS} שורות. אפשר לייבא אותם בכמה פעמים`);
    return { kind: "meetings", rows, files: files.length };
  }
  const rows: FbRow[] = [];
  for (const f of files) {
    const r = readFireberry(f);
    if (r.missing.length) throw new ActionError((files.length > 1 ? "באחד הקבצים לא מצאנו" : "לא מצאנו בקובץ") + " עמודה של " + r.missing.map((m) => (m === "name" ? "שם לקוח" : "טלפון")).join(" ו") + ". צריך קובץ ייצוא של לידים מפיירברי (CSV)");
    rows.push(...r.rows);
  }
  if (rows.length > MAX_ROWS) throw new ActionError(`בקבצים יותר מ-${MAX_ROWS} שורות. אפשר לייבא אותם בכמה פעמים`);
  return { kind: "leads", rows, files: files.length };
}

type Ref = { id: string; name: string };

function tally<T>(rows: T[], get: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(get(r), (m.get(get(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function previewLeads(rows: FbRow[], files: number, projects: Ref[], users: Ref[]): Promise<LeadsPreview> {
  const seen = new Set<string>();
  let dup = 0;
  for (const r of rows) {
    if (!r.phone) continue;
    if (seen.has(r.phone)) dup++;
    else seen.add(r.phone);
  }
  const phones = [...seen];
  let existing = 0;
  for (let i = 0; i < phones.length; i += 1000) existing += await prisma.lead.count({ where: { phone: { in: phones.slice(i, i + 1000) } } });
  const withPhone = rows.filter((r) => r.phone);
  const keys = [...new Set(withPhone.map(leadRowKey))];
  let already = 0;
  for (let i = 0; i < keys.length; i += 1000) already += await prisma.inquiry.count({ where: { externalId: { in: keys.slice(i, i + 1000) } } });
  return {
    kind: "leads",
    files,
    total: rows.length,
    valid: seen.size,
    badPhone: rows.length - withPhone.length,
    dupInFile: dup,
    existing,
    already,
    sources: tally(withPhone, (r) => r.source || NO_SOURCE).map(([source, count]) => ({ source, count, projectId: guessProject(source, projects) })),
    owners: tally(withPhone, (r) => r.owner)
      .filter(([n]) => n)
      .map(([name, count]) => ({ name, count, userId: users.find((u) => u.name.trim() === name)?.id ?? "" })),
    statuses: tally(withPhone, (r) => r.status).map(([from, count]) => {
      const m = mapStatus(from);
      return { from: from || "ללא סטטוס", count, to: ST[m.status].l + (m.reason && from !== "לא רלוונטי" ? ` (${m.reason})` : "") };
    }),
  };
}

type DatedMeeting = FbMeeting & { start: Date };

/** Meetings with a date, each once (the same meeting can appear in two exports). */
function uniqueMeetings(rows: FbMeeting[]): DatedMeeting[] {
  const seen = new Set<string>();
  const out: DatedMeeting[] = [];
  for (const r of rows) {
    if (!r.start) continue;
    const k = meetingKey(r as DatedMeeting);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r as DatedMeeting);
  }
  return out;
}

async function previewMeetings(rows: FbMeeting[], files: number, projects: Ref[], users: Ref[]): Promise<MeetingsPreview> {
  const now = new Date();
  const list = uniqueMeetings(rows);
  const known = await importedMeetingKeys(list);
  const existing = list.filter((r) => known.has(meetingKey(r)) || (!r.client && known.has(legacyMeetingKey(r)))).length;
  const noDate = rows.filter((r) => !r.start).length;
  return {
    kind: "meetings",
    files,
    total: rows.length,
    valid: list.length,
    noDate,
    dupInFile: rows.length - noDate - list.length,
    existing,
    upcoming: list.filter((r) => r.start >= now && mapMeetingStatus(r.status) === "set").length,
    reps: tally(list, (r) => r.rep)
      .filter(([n]) => n)
      .map(([name, count]) => ({ name, count, userId: users.find((u) => u.name.trim() === name)?.id ?? "" })),
    subjects: tally(list, (r) => r.subject || NO_SUBJECT).map(([subject, count]) => ({ subject, count, projectId: guessMeetingProject(subject, projects) })),
    statuses: tally(list, (r) => r.status).map(([from, count]) => ({ from: from || "ללא סטטוס", count, to: MS[mapMeetingStatus(from)].l })),
  };
}

export async function previewImportAction(files: string[]): Promise<ActionResult<ImportPreview>> {
  return run(async () => {
    await requireActionUser("leads.import");
    const parsed = parseFiles(files);
    const [projects, users] = await Promise.all([
      prisma.project.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    return { data: parsed.kind === "meetings" ? await previewMeetings(parsed.rows, parsed.files, projects, users) : await previewLeads(parsed.rows, parsed.files, projects, users) };
  });
}

/** Keys of these meetings that are already in the system, in today's form or the older one for meetings with no client. */
async function importedMeetingKeys(list: DatedMeeting[]): Promise<Set<string>> {
  const keys = [...new Set([...list.map((r) => meetingKey(r)), ...list.filter((r) => !r.client).map((r) => legacyMeetingKey(r))])];
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const rows = await prisma.meeting.findMany({ where: { externalId: { in: keys.slice(i, i + 1000) } }, select: { externalId: true } });
    for (const r of rows) if (r.externalId) found.add(r.externalId);
  }
  return found;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

async function validIds() {
  const [projects, users] = await Promise.all([prisma.project.findMany({ select: { id: true } }), prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } })]);
  return { projectIds: new Set(projects.map((p) => p.id)), userIds: new Set(users.map((x) => x.id)) };
}

export async function runImportAction(files: string[], map: { sources: Record<string, string>; owners: Record<string, string> }): Promise<ActionResult<{ created: number; merged: number; skipped: number }>> {
  return run(async () => {
    const u = await requireActionUser("leads.import");
    const parsed = parseFiles(files);
    if (parsed.kind !== "leads") throw new ActionError("אלה קבצים של פגישות, לא של לידים");
    const rows = parsed.rows;
    const { projectIds, userIds } = await validIds();
    const proj = (source: string) => {
      const id = map?.sources?.[source || NO_SOURCE];
      return id && projectIds.has(id) ? id : null;
    };
    const owner = (name: string) => {
      const id = map?.owners?.[name];
      return id && userIds.has(id) ? id : null;
    };
    const seen = new Set<string>();
    const good = rows.filter((r) => r.phone && r.name && !seen.has(r.phone) && seen.add(r.phone));
    let created = 0;
    let merged = 0;
    let again = 0;
    const runBatch = async (batch: FbRow[]) => {
      let c = 0;
      let m = 0;
      let a = 0;
      await prisma.$transaction(
        async (tx) => {
          const existing = new Map((await tx.lead.findMany({ where: { phone: { in: batch.map((r) => r.phone as string) } }, select: { id: true, phone: true } })).map((l) => [l.phone, l.id]));
          const imported = new Set(
            (await tx.inquiry.findMany({ where: { externalId: { in: batch.map(leadRowKey) } }, select: { externalId: true } })).map((x) => x.externalId),
          );
          for (const r of batch) {
            const phone = r.phone as string;
            const key = leadRowKey(r);
            // this row was imported before: nothing is added twice
            if (imported.has(key)) {
              a++;
              continue;
            }
            const note = `יובא מפיירברי${r.owner ? `. מנהל לקוח בפיירברי: ${r.owner}` : ""}${r.status ? `. סטטוס בפיירברי: ${r.status}` : ""}`;
            const leadId = existing.get(phone);
            if (leadId) {
              await tx.inquiry.create({ data: { leadId, source: r.source || "פיירברי", projectId: proj(r.source), campaign: r.ad || null, payload: { fireberry: true }, externalId: key } });
              await tx.activity.create({ data: { leadId, kind: "in", text: "פנייה מפיירברי נוספה לכרטיס הקיים", auto: note, userId: u.id } });
              m++;
              continue;
            }
            const { status, reason } = mapStatus(r.status);
            const createdAt = r.created ?? new Date();
            await tx.lead.create({
              data: {
                name: r.name,
                phone,
                email: r.email || null,
                source: r.source || "פיירברי",
                projectId: proj(r.source),
                status,
                lostReason: reason,
                ownerId: owner(r.owner),
                nextAt: r.next,
                // the export has no closing date: the last update is the closest to it
                closedAt: status === "won" ? (r.updated ?? createdAt) : null,
                createdAt,
                lastActivityAt: createdAt,
                createdById: u.id,
                inquiries: { create: { source: r.source || "פיירברי", projectId: proj(r.source), campaign: r.ad || null, payload: { fireberry: true }, createdAt, externalId: key } },
                activities: { create: { kind: "in", text: "יובא מפיירברי", auto: note, userId: u.id, createdAt } },
              },
            });
            existing.set(phone, "");
            c++;
          }
        },
        { timeout: 120_000 },
      );
      created += c;
      merged += m;
      again += a;
    };
    for (let i = 0; i < good.length; i += 200) {
      const batch = good.slice(i, i + 200);
      try {
        await runBatch(batch);
      } catch (err) {
        // a lead that arrived from a form in the meantime: the second try finds it and adds to it
        try {
          if (!isUniqueViolation(err)) throw err;
          await runBatch(batch);
        } catch {
          revalidatePath("/", "layout");
          throw new ActionError(`הייבוא נעצר באמצע. עד עכשיו נכנסו ${created} לידים חדשים ו-${merged} פניות לכרטיסים קיימים. אפשר להעלות שוב את אותו קובץ: מה שכבר נכנס לא ייכנס פעמיים.`);
        }
      }
    }
    const skipped = rows.length - good.length;
    await audit({ actorId: u.id, actorName: u.name, action: "lead.import", meta: { created, merged, again, skipped, files: parsed.files }, ip: await requestIp() });
    revalidatePath("/", "layout");
    const parts = [`${created} לידים חדשים`, `${merged} צורפו לכרטיסים קיימים`];
    if (again) parts.push(`${again} כבר יובאו בעבר ולא נוספו שוב`);
    parts.push(`${skipped} שורות דולגו`);
    return { message: `הייבוא הסתיים: ${parts.join(", ")}`, data: { created, merged, skipped } };
  });
}

/** Meetings are their own records: they are imported as they are, without creating leads. */
export async function runMeetingsImportAction(files: string[], map: { reps: Record<string, string>; subjects: Record<string, string> }): Promise<ActionResult<{ created: number; existing: number; skipped: number }>> {
  return run(async () => {
    const u = await requireActionUser("leads.import");
    const parsed = parseFiles(files);
    if (parsed.kind !== "meetings") throw new ActionError("אלה קבצים של לידים, לא של פגישות");
    const { projectIds, userIds } = await validIds();
    const proj = (subject: string) => {
      const id = map?.subjects?.[subject || NO_SUBJECT];
      return id && projectIds.has(id) ? id : null;
    };
    const rep = (name: string) => {
      const id = name ? map?.reps?.[name] : undefined;
      return id && userIds.has(id) ? id : null;
    };
    const now = Date.now();
    const unique = uniqueMeetings(parsed.rows);
    // meetings with no client imported by the first version of the import carry the older key
    const known = await importedMeetingKeys(unique.filter((r) => !r.client));
    const list = unique.filter((r) => r.client || !known.has(legacyMeetingKey(r)));
    const data = list.map((r) => ({
      externalId: meetingKey(r),
      clientName: r.client || null,
      subject: r.subject || null,
      source: r.source || null,
      repName: r.rep || null,
      setById: rep(r.rep),
      projectId: proj(r.subject),
      startAt: r.start,
      place: /זום|zoom/i.test(r.subject) ? "זום" : "",
      status: mapMeetingStatus(r.status),
      note: "יובא מפיירברי" + (r.status ? `. סטטוס בפיירברי: ${r.status}` : ""),
      // when it was set is unknown: use the meeting's own date (or Fireberry's last update), never later than now
      createdAt: new Date(Math.min(r.start.getTime(), (r.updated ?? r.start).getTime(), now)),
    }));
    let created = 0;
    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < data.length; i += 500) created += (await tx.meeting.createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count;
      },
      { timeout: 120_000 },
    );
    const noDate = parsed.rows.filter((r) => !r.start).length;
    const again = parsed.rows.length - noDate - created; // already in the system, or twice in the files
    await audit({ actorId: u.id, actorName: u.name, action: "meeting.import", meta: { created, existing: again, noDate, files: parsed.files }, ip: await requestIp() });
    revalidatePath("/", "layout");
    const parts = [created === 1 ? "נוספה פגישה אחת" : `נוספו ${created} פגישות`];
    if (again) parts.push(`${again} כבר היו ולא נוספו שוב`);
    if (noDate) parts.push(`${noDate} שורות בלי תאריך דולגו`);
    return { message: `הייבוא הסתיים: ${parts.join(". ")}`, data: { created, existing: again, skipped: noDate } };
  });
}
