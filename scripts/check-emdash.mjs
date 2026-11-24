#!/usr/bin/env node
// Fails when a tracked text file (or its name) contains U+2014 or U+2013.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BAD_CHARS = [
  ['\u2014', 'U+2014 EM DASH'],
  ['\u2013', 'U+2013 EN DASH'],
];
const SKIP_DIRS = new Set([
  '.git',
  '.tuffcode-ops',
  'Chief',
  'Noticing',
  'references',
  'others',
  'node_modules',
  'dist',
  'out',
  'release',
  'build',
  'coverage',
  'worktrees',
  'logs',
  'playwright-report',
  'test-results',
]);
const SKIP_FILES = new Set([
  'APPEND_SYSTEM.md',
  'chief.md',
  'decisions.md',
  'noticing.md',
  'plan.md',
  'PRD.md',
  'prompt.txt',
  'spec.md',
  'thinking.md',
]);

function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      const rel = relative(ROOT, join(dir, entry.name)).split('\\').join('/');
      if (!rel.includes('/') && SKIP_FILES.has(rel)) continue;
      acc.push(rel);
    }
  }
  return acc;
}

function listFiles() {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const files = out.split('\0').filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // fall through to the directory walk
  }
  return walk(ROOT, []);
}

const violations = [];
const files = listFiles();

for (const file of files) {
  for (const [char, label] of BAD_CHARS) {
    if (file.includes(char)) {
      violations.push(`${file}:1: ${label} in file name`);
    }
  }
  let bytes;
  try {
    bytes = readFileSync(join(ROOT, file));
  } catch {
    continue;
  }
  if (bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [char, label] of BAD_CHARS) {
      if (line.includes(char)) {
        violations.push(`${file}:${index + 1}: ${label}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`check-emdash: ${violations.length} violation(s)`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`check-emdash: clean (${files.length} files scanned)`);
