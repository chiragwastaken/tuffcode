import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillSource } from '@tuffcode/contracts';
import { isInside, tuffcodeHome } from '@tuffcode/shared';
import { parseFrontmatter, warnSkipped, type DiscoveryOptions } from '../commands/frontmatter.js';
import { badRequest, notFound } from '../errors.js';

const SKILL_FILE = 'SKILL.md';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A skill with its body deliberately not loaded. */
export interface SkillSummary {
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  source: SkillSource;
  pluginId: string | null;
}

/** The `skills` directory of one enabled plugin. */
export interface PluginSkillRoot {
  root: string;
  pluginId: string;
}

export interface SkillDiscoveryOptions extends DiscoveryOptions {
  /** Enabled plugins' skill directories, searched after the project and user roots. */
  pluginRoots?: readonly PluginSkillRoot[];
}

interface SkillRoot {
  root: string;
  source: SkillSource;
  pluginId: string | null;
}

/**
 * Search order decides precedence: project `.tuffcode/skills`, project
 * `.claude/skills` (the Claude Code layout, so a repo's own skills work as is), user
 * `~/.tuffcode/skills`, then enabled plugins. The first definition of a name wins.
 */
function orderedRoots(projectPath: string, plugins: readonly PluginSkillRoot[] = []): SkillRoot[] {
  return [
    { root: resolve(projectPath, '.tuffcode', 'skills'), source: 'project', pluginId: null },
    { root: resolve(projectPath, '.claude', 'skills'), source: 'claude-project', pluginId: null },
    { root: resolve(tuffcodeHome(), 'skills'), source: 'user', pluginId: null },
    ...plugins.map((plugin) => ({
      root: resolve(plugin.root),
      source: 'plugin' as const,
      pluginId: plugin.pluginId,
    })),
  ];
}

/** Every absolute root a skill body may be read from, in precedence order. */
export function skillRoots(projectPath: string, plugins: readonly PluginSkillRoot[] = []): string[] {
  return orderedRoots(projectPath, plugins).map((entry) => entry.root);
}

function readSkillDirectory(root: SkillRoot, options: DiscoveryOptions): SkillSummary[] {
  if (!existsSync(root.root)) return [];
  let entries;
  try {
    entries = readdirSync(root.root, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnSkipped(options, `cannot read skills directory ${root.root}: ${detail}`);
    return [];
  }
  const skills = new Map<string, SkillSummary>();
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const filePath = join(root.root, entry.name, SKILL_FILE);
    if (!existsSync(filePath)) continue;
    try {
      const parsed = parseFrontmatter(readFileSync(filePath, 'utf8'));
      if (parsed === null) {
        warnSkipped(options, `skipping invalid skill file ${filePath}: no frontmatter`);
        continue;
      }
      const name = parsed.data.name?.trim() ?? '';
      const description = parsed.data.description?.trim() ?? '';
      if (!NAME_PATTERN.test(name) || description.length === 0) {
        warnSkipped(
          options,
          `skipping invalid skill file ${filePath}: name and description required`,
        );
        continue;
      }
      if (skills.has(name)) {
        warnSkipped(options, `skipping duplicate skill ${name} in ${filePath}`);
        continue;
      }
      skills.set(name, {
        name,
        description,
        path: filePath,
        source: root.source,
        pluginId: root.pluginId,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnSkipped(options, `skipping unreadable skill file ${filePath}: ${detail}`);
    }
  }
  return [...skills.values()];
}

/**
 * Discovers project then user skills, keeping the first definition of a name.
 * Only frontmatter is parsed; skill bodies stay on disk until `loadSkill`.
 */
export function discoverSkills(
  projectPath: string,
  options: SkillDiscoveryOptions = {},
): SkillSummary[] {
  const roots = orderedRoots(projectPath, options.pluginRoots);
  const skills = new Map<string, SkillSummary>();
  for (const root of roots) {
    for (const skill of readSkillDirectory(root, options)) {
      if (!skills.has(skill.name)) skills.set(skill.name, skill);
    }
  }
  return [...skills.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * Reads a skill body after proving the file is inside one of the skills roots.
 * Symlinks are resolved first, so a link pointing outside the roots is rejected.
 */
export function readSkillBody(filePath: string, roots: readonly string[]): string {
  let real: string;
  try {
    real = realpathSync(filePath);
  } catch {
    throw notFound('skill file not found');
  }
  const contained = roots.some((root) => {
    let realRoot = resolve(root);
    try {
      realRoot = realpathSync(root);
    } catch {
      // A missing root cannot contain the file, but resolving it keeps the check honest.
    }
    return isInside(realRoot, real);
  });
  if (!contained) throw badRequest('skill path escapes skills directory');
  const parsed = parseFrontmatter(readFileSync(real, 'utf8'));
  if (parsed === null) throw badRequest('skill file has no frontmatter');
  return parsed.body;
}

/** Loads a discovered skill body by name. Unknown names are not-found. */
export function loadSkill(
  projectPath: string,
  name: string,
  options: SkillDiscoveryOptions = {},
): string {
  const skill = discoverSkills(projectPath, options).find((candidate) => candidate.name === name);
  if (skill === undefined) throw notFound(`skill not found: ${name}`);
  return readSkillBody(skill.path, skillRoots(projectPath, options.pluginRoots));
}
