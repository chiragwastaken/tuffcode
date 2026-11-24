import { existsSync } from 'node:fs';
import type { Model, ProviderKind, ProviderView } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import type { ReplaceModelInput, Repos } from '../db/repos/index.js';
import { notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import type { Secrets } from '../secrets/bridge.js';
import type { ResolveCommand } from '../adapters/resolveCommand.js';
import { validateProviderConfig } from './config.js';

export interface ProvidersUpsertInput {
  id?: string;
  kind: ProviderKind;
  label: string;
  config: Record<string, unknown>;
  secret?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
}

export interface ProvidersService {
  list(): ProviderView[];
  upsert(input: ProvidersUpsertInput): Promise<ProviderView>;
  remove(id: string): Promise<void>;
  test(id: string): Promise<ProviderTestResult>;
  listModels(providerId: string): Model[];
}

export interface ProvidersServiceDeps {
  repos: Repos;
  bus: EventBus;
  secrets: Secrets;
  resolveCommand: ResolveCommand;
  fetchFn?: typeof fetch;
}

const TEST_TIMEOUT_MS = 5_000;

const HINTS = {
  claude: 'Install Claude Code, then run claude auth login.',
  codex: 'Codex CLI not found. Install it with `npm install -g @openai/codex`, then run `codex login`.',
  opencode: 'Install OpenCode (`npm install -g opencode-ai`) so that `opencode` is on PATH.',
  acp: 'Install an ACP agent such as `agy` or `opencode`, or set the provider config `command`.',
} as const;

/** The bridge key for one provider. The database only ever stores this string. */
export function providerSecretKey(providerId: string): string {
  return `provider:${providerId}`;
}

function modelSeeds(config: Record<string, unknown>): ReplaceModelInput[] | null {
  const models = config['models'];
  if (!Array.isArray(models)) return null;
  return models.map((model) => {
    const entry = model as Record<string, unknown>;
    return {
      modelId: String(entry['id']),
      label: String(entry['label']),
      contextWindow: typeof entry['contextWindow'] === 'number' ? entry['contextWindow'] : null,
      isDefault: entry['isDefault'] === true,
    };
  });
}

function configuredCommand(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string' && first.trim().length > 0) return first.trim();
  }
  return null;
}

function stringHeaders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') headers[key] = entry;
  }
  return headers;
}

function modelCount(body: unknown): number {
  if (typeof body !== 'object' || body === null) return 0;
  const data = (body as Record<string, unknown>)['data'];
  return Array.isArray(data) ? data.length : 0;
}

export function createProvidersService(deps: ProvidersServiceDeps): ProvidersService {
  const fetchFn = deps.fetchFn ?? fetch;

  function emitUpdated(): void {
    deps.bus.emit({ kind: 'event', type: 'providers.updated', payload: deps.repos.providers.list() });
  }

  async function testOpenAI(
    config: Record<string, unknown>,
    secretRef: string | null,
  ): Promise<ProviderTestResult> {
    const baseUrl = String(config['baseUrl']).replace(/\/+$/, '');
    const headers: Record<string, string> = { accept: 'application/json' };
    const secret = secretRef === null ? null : await deps.secrets.get(secretRef);
    if (secret !== null) headers['authorization'] = `Bearer ${secret}`;
    Object.assign(headers, stringHeaders(config['headers']));
    try {
      const response = await fetchFn(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, detail: `endpoint returned HTTP ${response.status}` };
      }
      let count = 0;
      try {
        count = modelCount(await response.json());
      } catch {
        count = 0;
      }
      return { ok: true, detail: `${count} models available` };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      return { ok: false, detail: `request failed: ${message}` };
    }
  }

  async function testCommand(
    name: string,
    hint: string,
    configured: string | null,
  ): Promise<ProviderTestResult> {
    if (configured !== null) {
      if (configured.includes('/') || configured.includes('\\')) {
        return existsSync(configured)
          ? { ok: true, detail: configured }
          : { ok: false, detail: `${hint} (${configured} was not found)` };
      }
      const resolved = await deps.resolveCommand(configured);
      return resolved === null
        ? { ok: false, detail: `${hint} (${configured} was not found)` }
        : { ok: true, detail: resolved };
    }
    const resolved = await deps.resolveCommand(name);
    return resolved === null ? { ok: false, detail: hint } : { ok: true, detail: resolved };
  }

  return {
    list: () => deps.repos.providers.list(),

    upsert: async (input) => {
      const config = validateProviderConfig(input.kind, input.config);
      const id = input.id ?? newId('prv');
      const key = providerSecretKey(id);
      let secretRef: string | null | undefined;
      if (input.secret !== undefined) {
        if (input.secret.length > 0) {
          try {
            await deps.secrets.set(key, input.secret);
          } catch {
            throw new RpcError('internal', 'secret storage unavailable');
          }
          secretRef = key;
        } else {
          try {
            await deps.secrets.set(key, '');
          } catch {
            throw new RpcError('internal', 'secret storage unavailable');
          }
          secretRef = null;
        }
      }

      const view = deps.repos.providers.upsert({
        id,
        kind: input.kind,
        label: input.label,
        config,
        ...(secretRef === undefined ? {} : { secretRef }),
      });
      const seeds = modelSeeds(config);
      if (seeds !== null) deps.repos.providers.replaceModels(view.id, seeds);
      emitUpdated();
      return view;
    },

    remove: async (id) => {
      const provider = deps.repos.providers.get(id);
      if (provider !== undefined && provider.secretRef !== null) {
        await deps.secrets.set(provider.secretRef, '').catch(() => undefined);
      }
      deps.repos.providers.remove(id);
      emitUpdated();
    },

    test: async (id) => {
      const provider = deps.repos.providers.get(id);
      if (provider === undefined) throw notFound('provider not found');
      const config = provider.config;
      switch (provider.kind) {
        case 'claude': {
          const configured =
            typeof config['pathToClaudeCodeExecutable'] === 'string'
              ? config['pathToClaudeCodeExecutable'].trim()
              : '';
          if (configured.length > 0) {
            return existsSync(configured)
              ? { ok: true, detail: configured }
              : { ok: false, detail: `${HINTS.claude} (${configured} was not found)` };
          }
          return testCommand('claude', HINTS.claude, null);
        }
        case 'codex':
          return testCommand('codex', HINTS.codex, configuredCommand(config['command']));
        case 'acp':
          return testCommand(
            'agy',
            HINTS.acp,
            configuredCommand(config['command']) ?? configuredCommand(config['agentCommand']),
          );
        case 'opencode':
          return testCommand(
            'opencode',
            HINTS.opencode,
            configuredCommand(config['command']) ?? configuredCommand(config['agentCommand']),
          );
        case 'openai-compatible':
          return testOpenAI(config, provider.secretRef);
        default:
          return { ok: false, detail: `unsupported provider kind: ${String(provider.kind)}` };
      }
    },

    listModels: (providerId) => {
      if (deps.repos.providers.get(providerId) === undefined) {
        throw notFound('provider not found');
      }
      return deps.repos.providers.listModels(providerId);
    },
  };
}
