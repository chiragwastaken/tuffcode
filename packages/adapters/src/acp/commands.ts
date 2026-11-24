import { AdapterUnavailableError, type ProviderConfig } from '@tuffcode/contracts';

/**
 * A resolved ACP agent invocation.
 *
 * `command` is an executable name (resolved through `where`) or an absolute path.
 * `args` are passed verbatim after the executable.
 */
export interface AcpCommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly display: string;
  readonly installHint: string;
}

interface KnownAgent {
  readonly args: readonly string[];
  readonly installHint: string;
}

const KNOWN_AGENTS: Readonly<Record<string, KnownAgent>> = {
  agy: {
    args: ['acp'],
    installHint:
      'Install the Antigravity CLI so that `agy` is on PATH, then confirm it runs `agy acp`.',
  },
  opencode: {
    args: ['acp'],
    installHint:
      'Install OpenCode (`npm install -g opencode-ai`) so that `opencode` is on PATH, then confirm it runs `opencode acp`.',
  },
};

const GENERIC_HINT =
  'Set the provider config `command` to an executable that speaks the Agent Client Protocol, or install a supported agent such as `agy` or `opencode`.';

interface CommandParts {
  readonly command: string;
  readonly args: readonly string[];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length === value.length ? items : null;
}

function commandParts(value: unknown): CommandParts | null {
  const single = stringValue(value);
  if (single) {
    return { command: single, args: [] };
  }
  const list = stringList(value);
  if (!list || list.length === 0) {
    return null;
  }
  const [command, ...args] = list;
  if (!command || command.trim() === '') {
    return null;
  }
  return { command: command.trim(), args };
}

function envValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

/**
 * Resolves the executable and arguments for an ACP provider.
 *
 * Order: `config.command` (string or `[executable, ...args]`), then `config.agentCommand`.
 * Explicit `config.args` wins over args embedded in the command. Known agents (`agy`,
 * `opencode`) default to the `acp` subcommand.
 *
 * Throws `AdapterUnavailableError` when the provider config names no command.
 */
export function resolveAcpCommand(provider: ProviderConfig): AcpCommandSpec & {
  readonly env: Record<string, string>;
} {
  const config = provider.config;
  const base = commandParts(config.command) ?? commandParts(config.agentCommand);
  if (!base) {
    throw new AdapterUnavailableError(provider.id, `No ACP command configured. ${GENERIC_HINT}`);
  }

  const known = KNOWN_AGENTS[base.command.toLowerCase()];
  const explicitArgs = stringList(config.args);
  const args = explicitArgs ?? (base.args.length > 0 ? base.args : (known?.args ?? ['acp']));

  return {
    command: base.command,
    args,
    display: [base.command, ...args].join(' '),
    installHint: known?.installHint ?? GENERIC_HINT,
    env: envValue(config.env),
  };
}
