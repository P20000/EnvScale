import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { users, workspaces, clusters } from './src/db/schema.js';

async function test() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://envscale:envscale_password@localhost:5432/envscale';
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.log("Users:", await db.select().from(users));
  console.log("Workspaces:", await db.select().from(workspaces));
  console.log("Clusters:", await db.select().from(clusters));
  
  pool.end();
}
test();
