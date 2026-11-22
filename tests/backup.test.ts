// The full backup: one file that comes back exactly as it was.
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { BACKUP_TABLES, buildBackup, readBackup, restoreBackup } from "@/lib/backup";

/** A database in memory, enough for the backup's reads and writes. */
function fakeDb(data: Record<string, Record<string, unknown>[]>) {
  const written: Record<string, Record<string, unknown>[]> = {};
  const delegate = (t: string) => ({
    findMany: async () => data[t] ?? [],
    createMany: async ({ data: rows }: { data: Record<string, unknown>[] }) => {
      written[t] = [...(written[t] ?? []), ...rows];
      return { count: rows.length };
    },
  });
  const db = Object.fromEntries(BACKUP_TABLES.map((t) => [t, delegate(t)])) as Record<string, unknown>;
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db: db as unknown as PrismaClient, written };
}

describe("full backup", () => {
  it("every table comes back as it was: dates, Hebrew, JSON and a phone's signing key", async () => {
    const at = new Date("2026-11-22T10:00:00Z");
    const { db } = fakeDb({
      lead: [{ id: "l1", name: "נועה כהן", phone: "+972501234567", createdAt: at }],
      signDevice: [{ id: "d1", publicKey: new Uint8Array([1, 2, 255]) }],
      setting: [{ key: "lists.sources", value: ["פייסבוק", "גוגל"] }],
    });
    const { file, counts } = await buildBackup(db, at);
    expect(counts.lead).toBe(1);
    const b = readBackup(file);
    expect(b.createdAt).toBe(at.toISOString());
    expect(b.tables.lead?.[0]).toEqual({ id: "l1", name: "נועה כהן", phone: "+972501234567", createdAt: at.toISOString() });
    expect(Buffer.isBuffer(b.tables.signDevice?.[0].publicKey)).toBe(true);
    expect([...(b.tables.signDevice?.[0].publicKey as Buffer)]).toEqual([1, 2, 255]);
    expect(b.tables.setting?.[0].value).toEqual(["פייסבוק", "גוגל"]);
  });

  it("restores parents before children, and leaves empty JSON empty", async () => {
    const { db: source } = fakeDb({ inquiry: [{ id: "q1", leadId: "l1", payload: null }], lead: [{ id: "l1" }], role: [{ id: "r1" }] });
    const { db: target, written } = fakeDb({});
    const counts = await restoreBackup(target, readBackup((await buildBackup(source)).file));
    expect(Object.keys(written)).toEqual(["role", "lead", "inquiry"]);
    expect(written.inquiry[0]).toEqual({ id: "q1", leadId: "l1" });
    expect(counts.lead).toBe(1);
  });

  it("refuses a file that is not a backup of the system", () => {
    expect(() => readBackup(gzipSync(Buffer.from(JSON.stringify({ hello: 1 }))))).toThrow();
  });
});
