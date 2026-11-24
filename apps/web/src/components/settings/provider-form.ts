import type { ProviderKind, ProviderView } from '@tuffcode/contracts';
import {
  isSubscriptionKind,
  presetById,
  presetForProvider,
  providerModels,
  type PresetModel,
  type ProviderAuthMode,
  type ProviderPreset,
} from './provider-presets';

const PROVIDER_KINDS: readonly ProviderKind[] = [
  'claude',
  'codex',
  'anthropic',
  'openai-compatible',
  'acp',
  'opencode',
];

export interface ProviderDraft {
  kind: ProviderKind;
  presetId: string;
  label: string;
  baseUrl: string;
  model: string;
  models: PresetModel[];
  headers: string;
  secret: string;
  configDir: string;
  command: string;
}

export interface ProviderFieldErrors {
  kind?: string;
  label?: string;
  baseUrl?: string;
  model?: string;
  models?: string;
  headers?: string;
  secret?: string;
  configDir?: string;
  command?: string;
}

export interface ProviderValidationOptions {
  /** False when editing: an already stored secret does not need to be retyped. */
  isNew?: boolean;
  hasExistingSecret?: boolean;
}

export interface ProviderPayloadOptions extends ProviderValidationOptions {
  id?: string;
  existingConfig?: Record<string, unknown>;
  preset?: ProviderPreset;
}

export interface ProviderPayload {
  id?: string;
  kind: ProviderKind;
  label: string;
  config: Record<string, unknown>;
  secret?: string;
}

export interface ParsedHeaders {
  headers?: Record<string, string>;
  error?: string;
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Keys this module owns; an edit rewrites them instead of carrying stale values. */
const MANAGED_CONFIG_KEYS = [
  'preset',
  'baseUrl',
  'model',
  'models',
  'headers',
  'family',
  'configDir',
  'command',
  'args',
] as const;

export function isProviderKind(value: string): value is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(value);
}

export function authModeOfKind(kind: ProviderKind, preset?: ProviderPreset): ProviderAuthMode {
  if (isSubscriptionKind(kind)) return 'subscription';
  if (preset) return preset.auth;
  if (kind === 'acp' || kind === 'opencode') return 'cli';
  if (kind === 'anthropic') return 'api-key';
  return 'api-key';
}

function emptyDraft(): ProviderDraft {
  return {
    kind: 'claude',
    presetId: 'claude',
    label: '',
    baseUrl: '',
    model: '',
    models: [],
    headers: '',
    secret: '',
    configDir: '',
    command: '',
  };
}

export function providerDraftFromView(view?: ProviderView | null): ProviderDraft {
  if (!view) return emptyDraft();

  const preset = presetForProvider(view);
  const model = typeof view.config.model === 'string' ? view.config.model : '';
  const command = typeof view.config.command === 'string' ? view.config.command : '';

  return {
    kind: view.kind,
    presetId: preset?.id ?? '',
    label: view.label,
    baseUrl: typeof view.config.baseUrl === 'string' ? view.config.baseUrl : '',
    model,
    models: providerModels(view),
    headers: headersToText(view.config.headers),
    secret: '',
    configDir: typeof view.config.configDir === 'string' ? view.config.configDir : '',
    command,
  };
}

export function providerDraftFromPreset(preset: ProviderPreset): ProviderDraft {
  return {
    ...emptyDraft(),
    kind: preset.kind,
    presetId: preset.id,
    label: preset.label,
    baseUrl: preset.baseUrl ?? '',
    model: preset.defaultModel ?? preset.models[0]?.id ?? '',
    models: [...preset.models],
  };
}

export function headersToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function parseHeadersText(text: string): ParsedHeaders {
  const trimmed = text.trim();
  if (!trimmed) return { headers: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'Headers must be valid JSON.' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Headers must be a JSON object.' };
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!HEADER_NAME.test(name)) return { error: `Invalid header name: ${name}` };
    if (typeof value !== 'string') return { error: `Header ${name} must be a string.` };
    if (/[\r\n]/.test(value)) return { error: `Header ${name} cannot contain line breaks.` };
    headers[name] = value;
  }

  return { headers };
}

export function validateBaseUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a valid URL.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Base URL must use http or https.';
  }

  return undefined;
}

export function validateProviderDraft(
  draft: ProviderDraft,
  options: ProviderValidationOptions = {},
): ProviderFieldErrors {
  const errors: ProviderFieldErrors = {};
  const preset = presetById(draft.presetId);
  const auth = authModeOfKind(draft.kind, preset);

  if (!isProviderKind(draft.kind)) errors.kind = 'Choose a provider kind.';
  if (!draft.label.trim()) errors.label = 'Label is required.';

  if (auth === 'subscription') {
    if (draft.configDir.trim() && !/^[A-Za-z]:[\\/]|^\/|^~[\\/]/.test(draft.configDir.trim())) {
      errors.configDir = 'Enter an absolute path.';
    }
    return errors;
  }

  if (auth === 'api-key' || auth === 'local') {
    const baseUrl = draft.baseUrl.trim();
    if (!baseUrl) {
      errors.baseUrl = 'Base URL is required.';
    } else {
      const baseUrlError = validateBaseUrl(baseUrl);
      if (baseUrlError) errors.baseUrl = baseUrlError;
    }
    if (!draft.model.trim()) {
      errors.model = 'Choose or enter a model.';
    }
  }

  if (auth === 'api-key') {
    const needsSecret =
      preset?.requiresSecret === true && options.isNew !== false && !options.hasExistingSecret;
    if (needsSecret && !draft.secret.trim()) {
      errors.secret = 'API key is required.';
    }
  }

  if (auth === 'cli' && draft.kind === 'acp' && !draft.command.trim()) {
    errors.command = 'Command is required for an ACP agent.';
  }

  if (draft.headers.trim()) {
    const parsedHeaders = parseHeadersText(draft.headers);
    if (parsedHeaders.error) errors.headers = parsedHeaders.error;
  }

  return errors;
}

function modelSeeds(draft: ProviderDraft): Record<string, unknown>[] {
  const entries = [...draft.models];
  const model = draft.model.trim();
  if (model && !entries.some((entry) => entry.id === model)) {
    entries.push({ id: model, label: model });
  }
  return entries.map((entry) => ({
    id: entry.id,
    label: entry.label || entry.id,
    contextWindow: null,
    isDefault: entry.id === model,
  }));
}

/**
 * Builds the `providers.upsert` payload. Subscription payloads deliberately drop
 * the base URL, headers, and secret: those providers authenticate through the CLI.
 */
export function buildProviderPayload(
  draft: ProviderDraft,
  options: ProviderPayloadOptions = {},
): ProviderPayload {
  const preset = options.preset ?? presetById(draft.presetId);
  const auth = authModeOfKind(draft.kind, preset);
  const parsedHeaders = auth === 'subscription' ? { headers: {} } : parseHeadersText(draft.headers);
  if (parsedHeaders.error) throw new Error(parsedHeaders.error);

  const config: Record<string, unknown> = { ...options.existingConfig };
  for (const key of MANAGED_CONFIG_KEYS) delete config[key];

  if (preset) config.preset = preset.id;
  else if (draft.presetId) config.preset = draft.presetId;

  const baseUrl = draft.baseUrl.trim();
  const model = draft.model.trim();
  const configDir = draft.configDir.trim();
  const command = draft.command.trim();

  if (auth === 'subscription') {
    if (model) config.model = model;
    if (configDir) config.configDir = configDir;
    // Seed the preset list so the composer can offer models without extra fields.
    const seeds = modelSeeds({ ...draft, model: model || preset?.defaultModel || '' });
    if (seeds.length > 0) config.models = seeds;
  } else if (auth === 'api-key' || auth === 'local') {
    config.baseUrl = baseUrl;
    if (model) config.model = model;
    const family = preset?.family ?? (auth === 'local' ? 'local' : 'openai-compatible');
    config.family = family;
    const headers = parsedHeaders.headers ?? {};
    if (Object.keys(headers).length > 0) config.headers = headers;
  } else {
    if (command) {
      config.command = command;
      if (draft.kind === 'opencode') config.args = ['acp'];
    }
    if (model) config.model = model;
  }

  if (auth !== 'subscription' && auth !== 'cli') {
    const seeds = modelSeeds(draft);
    if (seeds.length > 0) config.models = seeds;
  } else if (auth === 'cli' && model) {
    config.models = modelSeeds(draft);
  }

  const payload: ProviderPayload = {
    kind: draft.kind,
    label: draft.label.trim(),
    config,
  };

  if (options.id) payload.id = options.id;

  const secret = draft.secret.trim();
  if (auth === 'api-key' && secret) payload.secret = secret;

  return payload;
}
