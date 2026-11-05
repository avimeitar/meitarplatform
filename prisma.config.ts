import { defineConfig } from "prisma/config";

// DATABASE_URL comes from Railway's PostgreSQL service (or a local .env in development).
try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env file: use the environment as is
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
});
