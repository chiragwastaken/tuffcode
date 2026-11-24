import { BUILT_IN_NAMES } from './builtins.js';
import type { ParsedCommand } from './types.js';

const SLASH_COMMAND = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/;

/**
 * Splits slash input into a command name and its arguments. Text that is not a
 * known command, including an unknown slash name, comes back as a plain message.
 * Built-in names are always accepted; pass the discovered command names to accept
 * project commands as well.
 */
export function parseCommand(input: string, names: Iterable<string> = []): ParsedCommand {
  const match = SLASH_COMMAND.exec(input.trimEnd());
  if (match === null) return { message: input };
  const name = match[1];
  if (name === undefined) return { message: input };
  const known = new Set(BUILT_IN_NAMES);
  for (const candidate of names) known.add(candidate);
  if (!known.has(name)) return { message: input };
  return { name, args: (match[2] ?? '').trim() };
}
