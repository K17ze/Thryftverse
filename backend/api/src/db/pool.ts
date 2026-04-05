import { Pool } from 'pg';
import { config } from '../config.js';

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

const useDedicatedReplicaPool =
  Boolean(config.databaseReplicaUrl)
  && config.databaseReplicaUrl !== config.databaseUrl;

export const replicaConfigured = useDedicatedReplicaPool;

export const readDb = useDedicatedReplicaPool
  ? new Pool({
      connectionString: config.databaseReplicaUrl,
      max: 20,
    })
  : db;

export async function closeDb() {
  if (readDb !== db) {
    await readDb.end();
  }

  await db.end();
}
