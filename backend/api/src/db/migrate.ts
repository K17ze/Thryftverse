import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(currentDir, 'migrations');

export async function runMigrations() {
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationFiles = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const fileName of migrationFiles) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
        [fileName]
      );

      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
        continue;
      }

      const migrationSql = await readFile(path.join(migrationsDir, fileName), 'utf8');

      await client.query('BEGIN');
      await client.query(migrationSql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [fileName]);
      await client.query('COMMIT');

      console.log(`[migrate] applied ${fileName}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

runMigrations()
  .then(async () => {
    console.log('[migrate] done');
    await db.end();
  })
  .catch(async (error) => {
    console.error('[migrate] failed', error);
    await db.end();
    process.exit(1);
  });
