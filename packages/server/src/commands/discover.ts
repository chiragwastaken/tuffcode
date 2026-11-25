import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { BUILT_IN_COMMANDS, BUILT_IN_NAMES } from './builtins.js';
import { parseFrontmatter, warnSkipped, type DiscoveryOptions } from './frontmatter.js';
import type { CommandDefinition } from './types.js';

const COMMANDS_DIR = join('.tuffcode', 'commands');
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CommandDiscoveryOptions extends DiscoveryOptions {
  /** Enabled plugins' `commands` directories, read after the project directory. */
  pluginDirs?: readonly string[];
}

/**
 * Project commands need `name` and `description` frontmatter. Plugin commands follow
 * the Claude Code layout, where the file name is the command and the description may
 * be the first body line.
 */
function readCommandFile(filePath: string, lenient = false): CommandDefinition | null {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(raw) ?? (lenient ? { data: {}, body: raw } : null);
  if (parsed === null) return null;
  const fallbackName = lenient ? basename(filePath, extname(filePath)) : '';
  const firstLine =
    parsed.body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => line.length > 0) ?? '';
  const name = parsed.data.name?.trim() || fallbackName;
  const description =
    parsed.data.description?.trim() || (lenient ? firstLine.slice(0, 160) : '');
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
  options: CommandDiscoveryOptions = {},
): CommandDefinition[] {
  const commands = new Map<string, CommandDefinition>();
  readCommandDir(resolve(projectPath, COMMANDS_DIR), options, commands, false);
  for (const dir of options.pluginDirs ?? []) readCommandDir(dir, options, commands, true);
  return [...commands.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

function readCommandDir(
  dir: string,
  options: DiscoveryOptions,
  commands: Map<string, CommandDefinition>,
  lenient: boolean,
): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnSkipped(options, `cannot read commands directory ${dir}: ${detail}`);
    return;
  }
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (extname(entry.name).toLowerCase() !== '.md') continue;
    const filePath = join(dir, entry.name);
    try {
      const command = readCommandFile(filePath, lenient);
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
}

/** Built-ins in palette order, then project and plugin commands sorted by name. */
export function listCommands(
  projectPath: string,
  options: CommandDiscoveryOptions = {},
): CommandDefinition[] {
  return [...BUILT_IN_COMMANDS, ...discoverCommands(projectPath, options)];
}
