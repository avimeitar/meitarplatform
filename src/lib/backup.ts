// A full backup of the system's data in one file, for a system administrator to download and keep (for example in a
// Google Drive folder), and the way back: scripts/restore-backup.ts puts it into an empty, migrated database.
// One gzipped JSON file: every table, in an order that restores cleanly. Sign-in sessions and other short-lived
// rows are left out: after a restore, everyone signs in again.
import { gunzipSync, gzipSync } from "node:zlib";
import type { PrismaClient } from "@/generated/prisma/client";

/** The tables, parents before children. */
export const BACKUP_TABLES = [
  "role",
  "user",
  "account",
  "twoFactor",
  "invite",
  "project",
  "lead",
  "inquiry",
  "activity",
  "meeting",
  "task",
  "leadAssignment",
  "actionLog",
  "apiKey",
  "setting",
  "workShift",
  "shiftSignature",
  "shiftEdit",
  "signDevice",
  "pushSubscription",
  "auditLog",
  "archiveBatch",
  "archiveRecord",
] as const;
type Table = (typeof BACKUP_TABLES)[number];

/** Json fields that may be empty: an empty one is left out on restore, so the database keeps it empty. */
const NULLABLE_JSON: Partial<Record<Table, string[]>> = { inquiry: ["payload"], auditLog: ["meta"] };

export type Backup = { kind: "meitar-backup"; version: 1; createdAt: string; tables: Partial<Record<Table, Record<string, unknown>[]>> };

type Delegate = { findMany: (args?: object) => Promise<Record<string, unknown>[]>; createMany: (args: { data: Record<string, unknown>[] }) => Promise<{ count: number }> };
const table = (db: PrismaClient, t: Table) => (db as unknown as Record<Table, Delegate>)[t];

// binary values (a phone's signing key) travel as base64
const encode = (_k: string, v: unknown) => (v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString("base64") } : typeof v === "bigint" ? v.toString() : v);
const decode = (_k: string, v: unknown) => (v && typeof v === "object" && "$bytes" in v && typeof (v as { $bytes: unknown }).$bytes === "string" ? Buffer.from((v as { $bytes: string }).$bytes, "base64") : v);

/** Every table, read one after the other, gzipped. */
export async function buildBackup(db: PrismaClient, now = new Date()): Promise<{ file: Buffer; counts: Record<string, number> }> {
  const out: Backup = { kind: "meitar-backup", version: 1, createdAt: now.toISOString(), tables: {} };
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows = await table(db, t).findMany();
    out.tables[t] = rows;
    counts[t] = rows.length;
  }
  return { file: gzipSync(Buffer.from(JSON.stringify(out, encode), "utf8")), counts };
}

export function readBackup(file: Buffer): Backup {
  const b = JSON.parse(gunzipSync(file).toString("utf8"), decode) as Backup;
  if (b?.kind !== "meitar-backup" || b.version !== 1 || typeof b.tables !== "object") throw new Error("This is not a backup file of the system");
  return b;
}

/** Puts a backup into a database that has the tables but no data yet. */
export async function restoreBackup(db: PrismaClient, b: Backup): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await db.$transaction(
    async (tx) => {
      for (const t of BACKUP_TABLES) {
        const rows = (b.tables[t] ?? []).map((r) => {
          const row = { ...r };
          for (const f of NULLABLE_JSON[t] ?? []) if (row[f] === null) delete row[f];
          return row;
        });
        let n = 0;
        for (let i = 0; i < rows.length; i += 1000) n += (await table(tx as unknown as PrismaClient, t).createMany({ data: rows.slice(i, i + 1000) })).count;
        counts[t] = n;
      }
    },
    { timeout: 30 * 60_000, maxWait: 30_000 },
  );
  return counts;
}
