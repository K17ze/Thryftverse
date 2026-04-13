import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const OUTPUT_PATH = path.join(ROOT, 'i18n-extraction-report.md');

const FILE_EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORE_DIRS = new Set(['__tests__', 'node_modules']);
const TARGET_PATTERN = /<Text[^>]*>([^<{][^<]*)<\/Text>/g;

function shouldSkipDir(dirName) {
  return IGNORE_DIRS.has(dirName);
}

function isLikelyLiteral(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return false;
  }

  if (/^[0-9.,:%+-]+$/.test(cleaned)) {
    return false;
  }

  if (cleaned.includes('{') || cleaned.includes('}')) {
    return false;
  }

  return /[A-Za-z]/.test(cleaned);
}

async function walkFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        const nestedFiles = await walkFiles(absolutePath);
        files.push(...nestedFiles);
      }
      continue;
    }

    const ext = path.extname(entry.name);
    if (FILE_EXTENSIONS.has(ext)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

async function extractFromFile(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const matches = [];

  for (const match of source.matchAll(TARGET_PATTERN)) {
    const full = match[0] ?? '';
    const value = (match[1] ?? '').trim();

    if (!full || !isLikelyLiteral(value)) {
      continue;
    }

    const line = getLineNumber(source, match.index ?? 0);
    matches.push({
      value: value.replace(/\s+/g, ' '),
      line,
    });
  }

  return matches;
}

async function main() {
  const files = await walkFiles(SRC_ROOT);
  const reportRows = [];

  for (const filePath of files) {
    const extracted = await extractFromFile(filePath);
    if (extracted.length === 0) {
      continue;
    }

    const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
    for (const row of extracted) {
      reportRows.push({
        file: relative,
        line: row.line,
        value: row.value,
      });
    }
  }

  reportRows.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = [];
  lines.push('# i18n Extraction Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total extracted text literals: ${reportRows.length}`);
  lines.push('');
  lines.push('| File | Line | Literal |');
  lines.push('| --- | ---: | --- |');

  for (const row of reportRows) {
    const safeValue = row.value.replace(/\|/g, '\\|');
    lines.push(`| ${row.file} | ${row.line} | ${safeValue} |`);
  }

  await fs.writeFile(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${reportRows.length} entries to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error('Failed to extract i18n strings:', error);
  process.exitCode = 1;
});
