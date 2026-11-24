import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainEntry } from '@tuffcode/contracts';
import { brainDir } from '@tuffcode/shared';
import type { BrainRepo } from '../db/repos/index.js';

/**
 * Human-readable mirror of the brain under `brainDir()`. The database stays the
 * source of truth; these files exist so rules, preferences and project context can
 * be read and exported without opening SQLite.
 */
const MIRROR_LIMIT = 200;

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function entryPaths(id: string): { rule: string; preference: string } {
  const name = `${safeName(id)}.md`;
  return {
    rule: join(brainDir(), 'rules', name),
    preference: join(brainDir(), 'preferences', name),
  };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function frontmatter(entry: BrainEntry): string {
  return [
    '---',
    `id: ${entry.id}`,
    `kind: ${entry.kind}`,
    `scope: ${entry.scope}`,
    `projectId: ${entry.projectId ?? 'null'}`,
    `appliesTo: ${entry.appliesTo ?? 'null'}`,
    `importance: ${entry.importance}`,
    `active: ${entry.active}`,
    `updatedAt: ${entry.updatedAt}`,
    '---',
  ].join('\n');
}

/** One markdown file for a rule or preference, frontmatter plus the entry text. */
export function renderEntryMarkdown(entry: BrainEntry): string {
  return `${frontmatter(entry)}\n\n${entry.text}\n`;
}

function renderProjectSection(entry: BrainEntry): string {
  return [`## ${entry.id}`, '', `importance: ${entry.importance}`, '', entry.text, ''].join('\n');
}

/**
 * Rewrites `projects/<id>.md` from every project entry that belongs to the project.
 * The file is removed when the last entry is deleted.
 */
export function writeProjectMirror(repo: BrainRepo, projectId: string | null): void {
  const entries = repo
    .list({ kind: 'project', limit: MIRROR_LIMIT })
    .filter((entry) => entry.projectId === projectId);
  const path = join(brainDir(), 'projects', `${safeName(projectId ?? 'global')}.md`);
  if (entries.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const heading = `# Project ${projectId ?? 'global'}`;
  write(path, `${heading}\n\n${entries.map(renderProjectSection).join('\n')}`);
}

/** Writes the mirror file for an entry, removing files left by an earlier kind. */
export function writeEntryMirror(repo: BrainRepo, entry: BrainEntry): void {
  if (entry.kind === 'project') {
    writeProjectMirror(repo, entry.projectId);
    return;
  }
  const paths = entryPaths(entry.id);
  rmSync(paths.rule, { force: true });
  rmSync(paths.preference, { force: true });
  if (entry.kind === 'rule') write(paths.rule, renderEntryMarkdown(entry));
  if (entry.kind === 'preference') write(paths.preference, renderEntryMarkdown(entry));
}

/** Removes the mirror file for a deleted entry. */
export function removeEntryMirror(repo: BrainRepo, entry: BrainEntry): void {
  if (entry.kind === 'project') {
    writeProjectMirror(repo, entry.projectId);
    return;
  }
  const paths = entryPaths(entry.id);
  rmSync(paths.rule, { force: true });
  rmSync(paths.preference, { force: true });
}
