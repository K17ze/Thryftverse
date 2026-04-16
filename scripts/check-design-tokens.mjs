#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();

const ALLOWED_FILES = new Set([
  'src/constants/colors.ts',
  'src/constants/typography.ts',
  'src/components/ui/AppButton.tsx',
  'src/components/ui/AppCard.tsx',
  'src/components/ui/AppStatusPill.tsx',
]);

const DEFAULT_ENFORCED_PATHS = [
  'src/components/ui/',
  'src/screens/CheckoutScreen.tsx',
  'src/screens/MakeOfferScreen.tsx',
  'src/screens/ItemDetailScreen.tsx',
  'src/screens/AuctionsScreen.tsx',
  'src/screens/TradeScreen.tsx',
  'src/screens/AssetDetailScreen.tsx',
  'src/screens/SyndicateHubScreen.tsx',
  'src/screens/InboxScreen.tsx',
  'src/screens/ChatScreen.tsx',
  'src/screens/BalanceScreen.tsx',
];

const TOKEN_IGNORE_MARKER = 'token-lint-ignore';

function toPathRule(rule) {
  return rule.trim().replace(/\\/g, '/');
}

function isFileInEnforcedScope(file) {
  const includeRaw = process.env.DESIGN_TOKEN_LINT_INCLUDE;
  const includeRules = (includeRaw ? includeRaw.split(',') : DEFAULT_ENFORCED_PATHS).map(toPathRule);

  return includeRules.some((rule) => {
    if (!rule) {
      return false;
    }

    if (rule.endsWith('/')) {
      return file.startsWith(rule);
    }

    return file === rule;
  });
}

const RULES = [
  { id: 'hex-color', label: 'hex color literal', regex: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'rgb-color', label: 'rgb/rgba color literal', regex: /rgba?\(/g },
];

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function hasWorkingTreeDiff() {
  const result = runGit(['diff', '--quiet', '--', 'src']);
  return result.code === 1;
}

function getChangedFiles() {
  if (hasWorkingTreeDiff()) {
    const result = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', '--', 'src']);
    if (result.code !== 0) {
      throw new Error(result.stderr || 'Unable to list changed files from working tree.');
    }

    return {
      mode: 'working-tree',
      files: result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.ts') || line.endsWith('.tsx')),
      diffArgsForFile: (file) => ['diff', '--unified=0', '--no-color', '--', file],
    };
  }

  const parentCheck = runGit(['rev-parse', '--verify', 'HEAD~1']);
  if (parentCheck.code !== 0) {
    const trackedFiles = runGit(['ls-files', 'src']);
    if (trackedFiles.code !== 0) {
      throw new Error(trackedFiles.stderr || 'Unable to list tracked src files.');
    }

    return {
      mode: 'all-tracked',
      files: trackedFiles.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.ts') || line.endsWith('.tsx')),
      diffArgsForFile: (file) => ['diff', '--unified=0', '--no-color', '--', file],
    };
  }

  const result = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD~1', 'HEAD', '--', 'src']);
  if (result.code !== 0) {
    throw new Error(result.stderr || 'Unable to list changed files from HEAD~1..HEAD.');
  }

  return {
    mode: 'head-range',
    files: result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.ts') || line.endsWith('.tsx')),
    diffArgsForFile: (file) => ['diff', '--unified=0', '--no-color', 'HEAD~1', 'HEAD', '--', file],
  };
}

function collectViolations(file, diffText) {
  const violations = [];
  const lines = diffText.split('\n');
  let newLineNumber = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)(?:,\d+)?/);
      if (match) {
        newLineNumber = Number.parseInt(match[1], 10) - 1;
      }
      continue;
    }

    if (!line.startsWith('+') || line.startsWith('+++')) {
      continue;
    }

    newLineNumber += 1;
    const addedLine = line.slice(1);

    if (addedLine.includes(TOKEN_IGNORE_MARKER)) {
      continue;
    }

    for (const rule of RULES) {
      if (!rule.regex.test(addedLine)) {
        continue;
      }

      violations.push({
        file,
        line: newLineNumber,
        rule: rule.label,
        snippet: addedLine.trim().slice(0, 200),
      });
      break;
    }
  }

  return violations;
}

function main() {
  const diffContext = getChangedFiles();
  const files = diffContext.files;

  if (files.length === 0) {
    console.log('Design token lint: no changed TS/TSX files to inspect.');
    process.exit(0);
  }

  const violations = [];

  for (const rawFile of files) {
    const normalizedFile = rawFile.split(path.sep).join('/');

    if (ALLOWED_FILES.has(normalizedFile)) {
      continue;
    }

    if (!isFileInEnforcedScope(normalizedFile)) {
      continue;
    }

    const diffResult = runGit(diffContext.diffArgsForFile(normalizedFile));
    if (diffResult.code !== 0) {
      throw new Error(diffResult.stderr || `Unable to inspect diff for ${normalizedFile}`);
    }

    violations.push(...collectViolations(normalizedFile, diffResult.stdout));
  }

  if (violations.length === 0) {
    console.log(`Design token lint: passed (${diffContext.mode}).`);
    process.exit(0);
  }

  console.error('Design token lint failed. New raw color literals were detected:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} (${violation.rule}) -> ${violation.snippet}`);
  }

  console.error('\nUse semantic tokens from src/constants/colors.ts or add a justified inline marker: token-lint-ignore');
  process.exit(1);
}

main();
