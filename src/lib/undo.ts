import { prisma, type Tx } from "./db";

// Server-side undo. Each change records what it created and the earlier values of what it changed,
// so the toast's "ביטול" can put everything back, including tasks and timeline entries it added.

export type UndoModel = "lead" | "activity" | "meeting" | "task" | "inquiry";
type Op = { t: "create"; model: UndoModel; id: string } | { t: "update"; model: UndoModel; id: string; before: Record<string, unknown> };

export const UNDO_WINDOW_MS = 2 * 60_000;

function delegate(tx: Tx, model: UndoModel) {
  // the five models share the calls used here
  return (tx as unknown as Record<UndoModel, { findUnique: Function; update: Function; deleteMany: Function }>)[model];
}

function pack(v: unknown): unknown {
  return v instanceof Date ? { $d: v.toISOString() } : v;
}
function unpack(v: unknown): unknown {
  return v && typeof v === "object" && "$d" in (v as Record<string, unknown>) ? new Date((v as { $d: string }).$d) : v;
}

export class Recorder {
  ops: Op[] = [];
  constructor(private tx: Tx) {}

  created(model: UndoModel, id: string) {
    this.ops.push({ t: "create", model, id });
  }

  /** Call before changing a row: remembers the current values of the fields about to change. */
  async before(model: UndoModel, id: string, fields: string[]) {
    if (this.ops.some((o) => (o.t === "update" || o.t === "create") && o.model === model && o.id === id)) {
      const existing = this.ops.find((o) => o.t === "update" && o.model === model && o.id === id) as Extract<Op, { t: "update" }> | undefined;
      if (!existing) return; // created in this same action: deleting it is enough
      const missing = fields.filter((f) => !(f in existing.before));
      if (!missing.length) return;
      const row = await delegate(this.tx, model).findUnique({ where: { id }, select: Object.fromEntries(missing.map((f) => [f, true])) });
      if (row) for (const f of missing) existing.before[f] = pack((row as Record<string, unknown>)[f]);
      return;
    }
    const row = await delegate(this.tx, model).findUnique({ where: { id }, select: Object.fromEntries(fields.map((f) => [f, true])) });
    if (!row) return;
    const before: Record<string, unknown> = {};
    for (const f of fields) before[f] = pack((row as Record<string, unknown>)[f]);
    this.ops.push({ t: "update", model, id, before });
  }
}

/** Runs a change in one transaction and keeps what is needed to undo it. */
export async function withUndo<T>(userId: string, label: string, fn: (tx: Tx, rec: Recorder) => Promise<T>): Promise<{ result: T; undoId: string | undefined }> {
  return prisma.$transaction(async (tx) => {
    const rec = new Recorder(tx);
    const result = await fn(tx, rec);
    if (!rec.ops.length) return { result, undoId: undefined };
    const log = await tx.actionLog.create({ data: { userId, label, ops: rec.ops as never } });
    return { result, undoId: log.id };
  });
}

export async function undo(userId: string, id: string): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const log = await prisma.actionLog.findUnique({ where: { id } });
  if (!log || log.userId !== userId) return { ok: false, error: "אי אפשר לבטל את הפעולה הזו" };
  if (log.undoneAt) return { ok: false, error: "הפעולה כבר בוטלה" };
  if (Date.now() - log.createdAt.getTime() > UNDO_WINDOW_MS) return { ok: false, error: "עבר יותר מדי זמן כדי לבטל" };
  const ops = (log.ops as unknown as Op[]) ?? [];
  await prisma.$transaction(async (tx) => {
    for (const op of [...ops].reverse()) {
      const d = delegate(tx, op.model);
      if (op.t === "create") await d.deleteMany({ where: { id: op.id } });
      else {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.before)) data[k] = unpack(v);
        await d.update({ where: { id: op.id }, data }).catch(() => {});
      }
    }
    await tx.actionLog.update({ where: { id }, data: { undoneAt: new Date() } });
  });
  return { ok: true, label: log.label };
}
