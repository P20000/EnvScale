import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

export function resolveMigrationsFolder(): string {
  // Candidate paths depending on whether running from TS source (src/db) or compiled (dist/db)
  const candidates = [
    path.resolve(__dirname, "migrations"),
    path.resolve(process.cwd(), "src/db/migrations"),
    path.resolve(process.cwd(), "dist/db/migrations"),
    path.resolve(process.cwd(), "apps/api-server/src/db/migrations"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "meta/_journal.json"))) {
      return candidate;
    }
  }

  // Fallback to relative path if not detected
  return "./src/db/migrations";
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  console.log(`[Migration Engine] Applying versioned Drizzle migrations from: ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log("[Migration Engine] All migrations successfully applied and verified.");
  } catch (error) {
    console.error("[Migration Engine] Migration failed:", error);
    throw error;
  }
}

// When invoked directly (e.g. via `pnpm db:migrate` or `tsx src/db/migrate.ts`)
if (typeof require !== "undefined" && require.main === module) {
  runMigrations()
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
