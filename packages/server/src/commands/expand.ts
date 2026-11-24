import type { CommandDefinition } from './types.js';

/** `$ARGUMENTS` or `$1` through `$9`, never the `$1` inside `$10`. */
const PLACEHOLDER = /\$ARGUMENTS|\$([1-9])(?![0-9])/g;

/**
 * Substitutes `$ARGUMENTS` with the whole argument string and `$1` through `$9`
 * with whitespace-separated positionals. One pass, so placeholders inside the
 * arguments themselves are left alone. Missing positionals become empty strings.
 */
export function expandArguments(template: string, args: string): string {
  const trimmed = args.trim();
  const positionals = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  return template.replace(PLACEHOLDER, (match, index: string | undefined) => {
    if (match === '$ARGUMENTS') return args;
    return positionals[Number(index) - 1] ?? '';
  });
}

export function expandCommand(command: Pick<CommandDefinition, 'body'>, args: string): string {
  return expandArguments(command.body, args);
}
