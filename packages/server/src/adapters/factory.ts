import {
  createAcpAdapter,
  createAnthropicAdapter,
  createClaudeAdapter,
  createCodexAdapter,
  createOpenAIChatAdapter,
  type OpenAIChatAdapterOverrides,
} from '@tuffcode/adapters';
import {
  AdapterUnavailableError,
  type AdapterDeps,
  type AdapterLogger,
  type AdapterSession,
  type ProviderConfig,
  type ProviderKind,
} from '@tuffcode/contracts';
import type { ProviderRecord } from '../db/repos/index.js';
import { createResolveCommand, type ResolveCommand } from './resolveCommand.js';

/** The fetch signature the OpenAI-compatible adapter accepts. */
export type AdapterFetch = NonNullable<OpenAIChatAdapterOverrides['fetchFn']>;

export type AdapterFactory = (
  provider: ProviderConfig,
  deps: AdapterDeps,
) => Promise<AdapterSession>;

export interface AdapterFactoryOverrides {
  /** Test seam: replaces the real factory per kind without spawning anything. */
  factories?: Partial<Record<ProviderKind, AdapterFactory>>;
  fetchFn?: AdapterFetch;
}

export interface AdapterDepsOptions {
  logger: AdapterLogger;
  resolveCommand?: ResolveCommand;
  env?: NodeJS.ProcessEnv;
}

/** Filters the environment to string values, which is all an adapter may pass on. */
export function adapterEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/** Shared adapter dependencies: one logger, one cached command resolver, the env. */
export function createAdapterDeps(options: AdapterDepsOptions): AdapterDeps {
  return {
    logger: options.logger,
    resolveCommand: options.resolveCommand ?? createResolveCommand(),
    env: adapterEnv(options.env),
  };
}

/** `opencode` always speaks ACP through its `acp` subcommand. */
function opencodeConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (config['command'] !== undefined || config['agentCommand'] !== undefined) return config;
  return { ...config, command: 'opencode', args: config['args'] ?? ['acp'] };
}

/**
 * Builds the contract session for one provider row. Every kind maps to a real
 * factory; an unknown kind is `AdapterUnavailableError`, never a bare throw.
 */
export async function createAdapterForProvider(
  provider: ProviderRecord,
  deps: AdapterDeps,
  secret: string | null,
  overrides: AdapterFactoryOverrides = {},
): Promise<AdapterSession> {
  const descriptor: ProviderConfig = {
    id: provider.id,
    kind: provider.kind,
    label: provider.label,
    config: provider.config,
    secret,
  };
  const factories = overrides.factories ?? {};
  const openai: AdapterFactory = (config, adapterDeps) =>
    createOpenAIChatAdapter(
      config,
      adapterDeps,
      overrides.fetchFn === undefined ? {} : { fetchFn: overrides.fetchFn },
    );

  switch (provider.kind) {
    case 'claude':
      return (factories.claude ?? createClaudeAdapter)(descriptor, deps);
    case 'codex':
      return (factories.codex ?? createCodexAdapter)(descriptor, deps);
    case 'acp':
      return (factories.acp ?? createAcpAdapter)(descriptor, deps);
    case 'opencode':
      return (factories.opencode ?? factories.acp ?? createAcpAdapter)(
        { ...descriptor, config: opencodeConfig(descriptor.config) },
        deps,
      );
    case 'openai-compatible':
      return (factories['openai-compatible'] ?? openai)(descriptor, deps);
    case 'anthropic':
      return (factories.anthropic ?? createAnthropicAdapter)(descriptor, deps);
    default:
      throw new AdapterUnavailableError(
        provider.id,
        `unsupported provider kind "${String(provider.kind)}". Configure claude, codex, acp, opencode, openai-compatible, or anthropic.`,
      );
  }
}
