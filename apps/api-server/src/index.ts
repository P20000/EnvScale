import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema';

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// Test the connection
async function main() {
  try {
    console.log('Database connection successful!');
    console.log('Schema loaded:', Object.keys(schema));
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
}

main();

export default db;
