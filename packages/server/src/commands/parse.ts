import { BUILT_IN_NAMES } from './builtins.js';
import type { ParsedCommand } from './types.js';

const SLASH_COMMAND = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:[ \t]+([\s\S]*))?$/;

/**
 * Splits slash input into a command name and its arguments. Text that is not a
 * known command, including an unknown slash name, comes back as a plain message.
 * `names` defaults to the built-ins; pass the discovered command names to accept
 * project commands as well.
 */
export function parseCommand(
  input: string,
  names: Iterable<string> = BUILT_IN_NAMES,
): ParsedCommand {
  const match = SLASH_COMMAND.exec(input.trimEnd());
  if (match === null) return { message: input };
  const name = match[1];
  if (name === undefined || !new Set(names).has(name)) return { message: input };
  return { name, args: (match[2] ?? '').trim() };
}
