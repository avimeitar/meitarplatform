// Production start (Railway): apply database migrations, then start the web server.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const bin = (name) => (existsSync(`node_modules/.bin/${name}`) ? `node_modules/.bin/${name}` : name);

if (process.env.DATABASE_URL) {
  const r = spawnSync(bin("prisma"), ["migrate", "deploy"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[start] database migration failed");
    process.exit(r.status ?? 1);
  }
} else {
  console.warn("[start] DATABASE_URL is not set: starting without a database (the site shows what to connect)");
}

const port = process.env.PORT || "3000";
const child = spawn(bin("next"), ["start", "-p", port, "-H", "0.0.0.0"], { stdio: "inherit" });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
