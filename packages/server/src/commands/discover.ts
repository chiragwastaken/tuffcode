import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { BUILT_IN_COMMANDS, BUILT_IN_NAMES } from './builtins.js';
import { parseFrontmatter, warnSkipped, type DiscoveryOptions } from './frontmatter.js';
import type { CommandDefinition } from './types.js';

const COMMANDS_DIR = join('.tuffcode', 'commands');
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function readCommandFile(filePath: string): CommandDefinition | null {
  const parsed = parseFrontmatter(readFileSync(filePath, 'utf8'));
  if (parsed === null) return null;
  const name = parsed.data.name?.trim() ?? '';
  const description = parsed.data.description?.trim() ?? '';
  if (!NAME_PATTERN.test(name) || description.length === 0) return null;
  const hint = parsed.data['argument-hint']?.trim();
  return {
    name,
    description,
    body: parsed.body,
    path: filePath,
    argumentHint: hint === undefined || hint.length === 0 ? null : hint,
  };
}

/**
 * Discovers `<project>/.tuffcode/commands/*.md`. A file is skipped with a warning
 * when it has no frontmatter, no name or description, a name that collides with a
 * built-in or another file, or cannot be read.
 */
export function discoverCommands(
  projectPath: string,
  options: DiscoveryOptions = {},
): CommandDefinition[] {
  const dir = resolve(projectPath, COMMANDS_DIR);
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnSkipped(options, `cannot read commands directory ${dir}: ${detail}`);
    return [];
  }
  const commands = new Map<string, CommandDefinition>();
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (extname(entry.name).toLowerCase() !== '.md') continue;
    const filePath = join(dir, entry.name);
    try {
      const command = readCommandFile(filePath);
      if (command === null) {
        warnSkipped(options, `skipping invalid command file ${filePath}`);
        continue;
      }
      if (BUILT_IN_NAMES.has(command.name)) {
        warnSkipped(options, `skipping command ${command.name}: the name is built in`);
        continue;
      }
      if (commands.has(command.name)) {
        warnSkipped(options, `skipping duplicate command ${command.name} in ${filePath}`);
        continue;
      }
      commands.set(command.name, command);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnSkipped(options, `skipping unreadable command file ${filePath}: ${detail}`);
    }
  }
  return [...commands.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Built-ins in palette order, then project commands sorted by name. */
export function listCommands(
  projectPath: string,
  options: DiscoveryOptions = {},
): CommandDefinition[] {
  return [...BUILT_IN_COMMANDS, ...discoverCommands(projectPath, options)];
}
