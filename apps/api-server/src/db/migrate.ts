import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function runMigrations() {
  console.log("[Migration Engine] Applying versioned Drizzle migrations...");
  try {
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    console.log("[Migration Engine] All migrations successfully applied and verified.");
  } catch (error) {
    console.error("[Migration Engine] Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void runMigrations();
