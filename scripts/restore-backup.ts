// Puts a backup file (downloaded from the archive screen: "הורדת גיבוי מלא") into an EMPTY database.
//   1. a new, empty PostgreSQL database, and DATABASE_URL pointing at it
//   2. npx prisma migrate deploy
//   3. npx tsx scripts/restore-backup.ts meitar-backup-2026-11-22-1800.json.gz --yes
// It refuses a database that already has users or clients, so it can never mix with live data.
import { readFileSync } from "node:fs";
import { readBackup, restoreBackup } from "../src/lib/backup";
import { prisma } from "../src/lib/db";

async function main() {
  const path = process.argv[2];
  if (!path || !process.argv.includes("--yes")) throw new Error("Usage: npx tsx scripts/restore-backup.ts <backup file> --yes");
  if ((await prisma.user.count()) > 0 || (await prisma.lead.count()) > 0) throw new Error("This database already has data. Restore only into a new, empty database.");
  const backup = readBackup(readFileSync(path));
  const counts = await restoreBackup(prisma, backup);
  console.log(`Restored the backup from ${backup.createdAt}:`);
  for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t}: ${n}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
