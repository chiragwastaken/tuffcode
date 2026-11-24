import type { Model, ProviderKind, ProviderView } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import type { ReplaceModelInput, Repos } from '../db/repos/index.js';
import { badRequest, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import type { Secrets } from '../secrets/bridge.js';
import type { ResolveCommand } from '../adapters/resolveCommand.js';
import { configuredCommand, resolveCliPath, runCommand, type RunCommand } from './command.js';
import { DEFAULT_ANTHROPIC_BASE_URL, validateProviderConfig } from './config.js';
import { HINTS } from './hints.js';
import { createProviderLogins, type KillLoginTree, type SpawnLoginPty } from './login.js';
import { parseClaudeAuthStatus, parseCodexLoginStatus } from './status.js';

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
  /** Subscription providers only: whether the vendor CLI is signed in. */
  signedIn?: boolean;
  /** Subscription providers only: the resolved CLI path. */
  cliPath?: string;
  /** API providers only: model ids reported by the endpoint, when cheap to read. */
  models?: string[];
}

export interface ProvidersService {
  list(): ProviderView[];
  upsert(input: ProvidersUpsertInput): Promise<ProviderView>;
  remove(id: string): Promise<void>;
  test(id: string): Promise<ProviderTestResult>;
  listModels(providerId: string): Model[];
  login(providerId: string): Promise<{ loginId: string }>;
  cancelLogin(loginId: string): Promise<void>;
}

export interface ProvidersServiceDeps {
  repos: Repos;
  bus: EventBus;
  secrets: Secrets;
  resolveCommand: ResolveCommand;
  fetchFn?: typeof fetch;
  runCommand?: RunCommand;
  spawnPty?: SpawnLoginPty;
  killTree?: KillLoginTree;
}

const TEST_TIMEOUT_MS = 5_000;
const ANTHROPIC_VERSION = '2023-06-01';

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

function stringHeaders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') headers[key] = entry;
  }
  return headers;
}

/** Reads the `data[].id` list both OpenAI and Anthropic model endpoints return. */
function modelIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const data = (body as Record<string, unknown>)['data'];
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

function configString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'request failed';
  return `request failed: ${message}`;
}

export function createProvidersService(deps: ProvidersServiceDeps): ProvidersService {
  const fetchFn = deps.fetchFn ?? fetch;
  const runCommandFn = deps.runCommand ?? runCommand;
  const logins = createProviderLogins({
    repos: deps.repos,
    bus: deps.bus,
    resolveCommand: deps.resolveCommand,
    ...(deps.spawnPty === undefined ? {} : { spawnPty: deps.spawnPty }),
    ...(deps.killTree === undefined ? {} : { killTree: deps.killTree }),
  });

  function emitUpdated(): void {
    deps.bus.emit({
      kind: 'event',
      type: 'providers.updated',
      payload: deps.repos.providers.list(),
    });
  }

  async function secretFor(secretRef: string | null): Promise<string | null> {
    if (secretRef === null) return null;
    const secret = await deps.secrets.get(secretRef);
    return secret !== null && secret.length > 0 ? secret : null;
  }

  async function testOpenAI(
    config: Record<string, unknown>,
    secretRef: string | null,
  ): Promise<ProviderTestResult> {
    const baseUrl = String(config['baseUrl']).replace(/\/+$/, '');
    const headers: Record<string, string> = { accept: 'application/json' };
    const secret = await secretFor(secretRef);
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
      const models = modelIds(await response.json().catch(() => null));
      return { ok: true, detail: `${models.length} models available`, models };
    } catch (error) {
      return { ok: false, detail: failure(error) };
    }
  }

  async function testAnthropic(
    config: Record<string, unknown>,
    secretRef: string | null,
  ): Promise<ProviderTestResult> {
    const secret = await secretFor(secretRef);
    if (secret === null) return { ok: false, detail: 'no API key stored' };
    const baseUrl = configString(config, 'baseUrl') ?? DEFAULT_ANTHROPIC_BASE_URL;
    const trimmed = baseUrl.replace(/\/+$/, '');
    const url = /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': secret,
    };
    Object.assign(headers, stringHeaders(config['headers']));
    try {
      const response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, detail: `endpoint returned HTTP ${response.status}` };
      }
      const models = modelIds(await response.json().catch(() => null));
      return { ok: true, detail: `${models.length} models available`, models };
    } catch (error) {
      return { ok: false, detail: failure(error) };
    }
  }

  async function testCommand(
    name: string,
    hint: string,
    configured: string | null,
  ): Promise<ProviderTestResult> {
    const resolved = await resolveCliPath(deps.resolveCommand, configured, name);
    if (resolved !== null) return { ok: true, detail: resolved };
    return {
      ok: false,
      detail: configured === null ? hint : `${hint} (${configured} was not found)`,
    };
  }

  /** `claude auth status --json` reports `loggedIn`; the CLI path comes from resolution. */
  async function testClaude(configured: string | null): Promise<ProviderTestResult> {
    const cliPath = await resolveCliPath(deps.resolveCommand, configured, 'claude');
    if (cliPath === null) {
      return {
        ok: false,
        signedIn: false,
        detail:
          configured === null ? HINTS.claude : `${HINTS.claude} (${configured} was not found)`,
      };
    }
    const status = parseClaudeAuthStatus(
      await runCommandFn(cliPath, ['auth', 'status', '--json'], TEST_TIMEOUT_MS),
    );
    return { ok: status.signedIn, detail: status.detail, signedIn: status.signedIn, cliPath };
  }

  /** `codex login status` exits 0 only when signed in. */
  async function testCodex(configured: string | null): Promise<ProviderTestResult> {
    const cliPath = await resolveCliPath(deps.resolveCommand, configured, 'codex');
    if (cliPath === null) {
      return {
        ok: false,
        signedIn: false,
        detail: configured === null ? HINTS.codex : `${HINTS.codex} (${configured} was not found)`,
      };
    }
    const status = parseCodexLoginStatus(
      await runCommandFn(cliPath, ['login', 'status'], TEST_TIMEOUT_MS),
    );
    return { ok: status.signedIn, detail: status.detail, signedIn: status.signedIn, cliPath };
  }

  return {
    list: () => deps.repos.providers.list(),

    upsert: async (input) => {
      const config = validateProviderConfig(input.kind, input.config);
      const id = input.id ?? newId('prv');
      const existing = deps.repos.providers.get(id);
      const willHaveSecret =
        input.secret === undefined
          ? existing !== undefined && existing.secretRef !== null
          : input.secret.length > 0;
      if (input.kind === 'anthropic' && !willHaveSecret) {
        throw badRequest('anthropic providers require an API key');
      }

      const key = providerSecretKey(id);
      let secretRef: string | null | undefined;
      if (input.secret !== undefined) {
        try {
          await deps.secrets.set(key, input.secret);
        } catch {
          throw new RpcError('internal', 'secret storage unavailable');
        }
        secretRef = input.secret.length > 0 ? key : null;
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
        case 'claude':
          return testClaude(configString(config, 'pathToClaudeCodeExecutable'));
        case 'codex':
          return testCodex(configuredCommand(config['command']));
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
        case 'anthropic':
          return testAnthropic(config, provider.secretRef);
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

    login: (providerId) => logins.start(providerId),
    cancelLogin: (loginId) => logins.cancel(loginId),
  };
}
