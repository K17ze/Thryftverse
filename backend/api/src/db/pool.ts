import { Pool } from 'pg';
import { config } from '../config.js';

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export async function closeDb() {
  await db.end();
}
