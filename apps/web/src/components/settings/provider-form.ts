import type { ProviderKind, ProviderView } from '@tuffcode/contracts';

export interface ProviderKindOption {
  value: ProviderKind;
  label: string;
}

export const PROVIDER_KIND_OPTIONS: readonly ProviderKindOption[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'acp', label: 'ACP agent' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
];

const PROVIDER_KINDS: readonly string[] = PROVIDER_KIND_OPTIONS.map((option) => option.value);

export interface ProviderDraft {
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  model: string;
  headers: string;
  secret: string;
}

export interface ProviderFieldErrors {
  kind?: string;
  label?: string;
  baseUrl?: string;
  model?: string;
  headers?: string;
  secret?: string;
}

export interface ProviderPayloadOptions {
  id?: string;
  existingConfig?: Record<string, unknown>;
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

export function isProviderKind(value: string): value is ProviderKind {
  return PROVIDER_KINDS.includes(value);
}

export function providerDraftFromView(view?: ProviderView | null): ProviderDraft {
  if (!view) {
    return { kind: 'claude', label: '', baseUrl: '', model: '', headers: '', secret: '' };
  }

  return {
    kind: view.kind,
    label: view.label,
    baseUrl: typeof view.config.baseUrl === 'string' ? view.config.baseUrl : '',
    model: typeof view.config.model === 'string' ? view.config.model : '',
    headers: headersToText(view.config.headers),
    secret: '',
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

function validateBaseUrl(value: string): string | undefined {
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

export function validateProviderDraft(draft: ProviderDraft): ProviderFieldErrors {
  const errors: ProviderFieldErrors = {};

  if (!isProviderKind(draft.kind)) errors.kind = 'Choose a provider kind.';
  if (!draft.label.trim()) errors.label = 'Label is required.';

  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) {
    if (draft.kind === 'openai-compatible') {
      errors.baseUrl = 'Base URL is required for an OpenAI-compatible provider.';
    }
  } else {
    const baseUrlError = validateBaseUrl(baseUrl);
    if (baseUrlError) errors.baseUrl = baseUrlError;
  }

  const parsedHeaders = parseHeadersText(draft.headers);
  if (parsedHeaders.error) errors.headers = parsedHeaders.error;

  return errors;
}

export function buildProviderPayload(
  draft: ProviderDraft,
  options: ProviderPayloadOptions = {},
): ProviderPayload {
  const parsedHeaders = parseHeadersText(draft.headers);
  if (parsedHeaders.error) throw new Error(parsedHeaders.error);

  const config: Record<string, unknown> = { ...options.existingConfig };

  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) config.baseUrl = baseUrl;
  else delete config.baseUrl;

  const model = draft.model.trim();
  if (model) config.model = model;
  else delete config.model;

  const headers = parsedHeaders.headers ?? {};
  if (Object.keys(headers).length > 0) config.headers = headers;
  else delete config.headers;

  const payload: ProviderPayload = {
    kind: draft.kind,
    label: draft.label.trim(),
    config,
  };

  if (options.id) payload.id = options.id;

  const secret = draft.secret.trim();
  if (secret) payload.secret = secret;

  return payload;
}
