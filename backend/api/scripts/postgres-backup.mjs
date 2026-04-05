import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

function parseRetentionDays(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function runPgDump({ databaseUrl, outputPath }) {
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    outputPath,
    databaseUrl,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pg_dump exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function cleanupOldBackups({ backupDir, retentionDays }) {
  const entries = await readdir(backupDir);
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let removed = 0;

  for (const entry of entries) {
    if (!entry.startsWith('thryftverse_') || !entry.endsWith('.dump')) {
      continue;
    }

    const fullPath = path.join(backupDir, entry);
    const details = await stat(fullPath);

    if (details.mtimeMs < cutoffMs) {
      await rm(fullPath, { force: true });
      removed += 1;
    }
  }

  return removed;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run backup:db');
  }

  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.resolve(process.cwd(), 'backups');

  const retentionDays = parseRetentionDays(process.env.BACKUP_RETENTION_DAYS, 14);

  await mkdir(backupDir, { recursive: true });

  const fileName = `thryftverse_${timestampForFile(new Date())}.dump`;
  const outputPath = path.join(backupDir, fileName);

  await runPgDump({ databaseUrl, outputPath });

  const removed = await cleanupOldBackups({ backupDir, retentionDays });

  const result = {
    ok: true,
    backupFile: outputPath,
    retentionDays,
    removedOldBackups: removed,
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[backup:db] failed', error);
  process.exit(1);
});
