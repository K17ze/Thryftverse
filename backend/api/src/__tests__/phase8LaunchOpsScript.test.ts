import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testFilePath = fileURLToPath(import.meta.url);
const testsDirectory = path.dirname(testFilePath);
const repositoryRoot = path.resolve(testsDirectory, '..', '..', '..', '..');
const phase8ScriptPath = path.resolve(testsDirectory, '..', '..', '..', 'scripts', 'phase8-launch-ops.mjs');

function runPhase8Script(args: string[], envOverrides: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [phase8ScriptPath, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: 'utf8',
  });
}

test('phase8 launch ops script prints help and exits cleanly', () => {
  const result = runPhase8Script(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node backend\/scripts\/phase8-launch-ops\.mjs \[options\]/);
  assert.match(result.stdout, /--cleanup-db\s+Execute DB cleanup logic in dry-run mode/);
});

test('phase8 launch ops script runs non-destructive checks and emits JSON summary', () => {
  const result = runPhase8Script(['--skip-env', '--skip-ssl', '--json']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[phase8\] Starting Phase 8 launch operations check/);
  assert.match(result.stdout, /\[phase8\] JSON summary/);
  assert.match(result.stdout, /"cleanup"\s*:\s*\{/);
  assert.match(result.stdout, /status:\s+passed/);
});

test('phase8 launch ops script fails cleanup mode without DATABASE_URL', () => {
  const result = runPhase8Script(
    ['--skip-env', '--skip-ssl', '--cleanup-db'],
    {
      DATABASE_URL: '',
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /error cleanup failed: DATABASE_URL is required for cleanup-db execution\./);
  assert.match(result.stdout, /status:\s+failed/);
});
