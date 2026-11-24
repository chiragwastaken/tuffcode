import type { ProviderKind } from '@tuffcode/contracts';
import { badRequest } from '../errors.js';

/**
 * Provider config is stored as free-form JSON, so the edge validates the keys the
 * adapters actually read and leaves everything else untouched for forward
 * compatibility. Failures name the field path.
 */

const KINDS: readonly ProviderKind[] = [
  'claude',
  'codex',
  'acp',
  'opencode',
  'openai-compatible',
  'anthropic',
];

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

function fail(path: string, expectation: string): never {
  throw badRequest(`config.${path} ${expectation}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(config: Record<string, unknown>, key: string): void {
  const value = config[key];
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(key, 'must be a non-empty string');
  }
}

function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
  );
}

/** A command may be an executable name or `[executable, ...args]`. */
function commandValue(config: Record<string, unknown>, key: string): void {
  const value = config[key];
  if (value === undefined) return;
  if (typeof value === 'string') {
    if (value.trim().length === 0) fail(key, 'must be a non-empty string');
    return;
  }
  if (!stringList(value)) fail(key, 'must be a non-empty string or an array of strings');
  if (value[0]?.trim().length === 0) fail(key, 'must name an executable');
}

function optionalStringList(config: Record<string, unknown>, key: string): void {
  const value = config[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    fail(key, 'must be an array of strings');
  }
}

function optionalStringRecord(config: Record<string, unknown>, key: string): void {
  const value = config[key];
  if (value === undefined) return;
  if (!isPlainObject(value)) fail(key, 'must be an object of string values');
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') fail(`${key}.${name}`, 'must be a string');
  }
}

function optionalPositiveInteger(config: Record<string, unknown>, key: string): void {
  const value = config[key];
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(key, 'must be a positive integer');
  }
}

function validateModels(config: Record<string, unknown>): void {
  const models = config['models'];
  if (models === undefined) return;
  if (!Array.isArray(models)) fail('models', 'must be an array');
  let defaults = 0;
  models.forEach((model, index) => {
    const path = `models[${index}]`;
    if (!isPlainObject(model)) fail(path, 'must be an object');
    if (typeof model['id'] !== 'string' || model['id'].trim().length === 0) {
      fail(`${path}.id`, 'must be a non-empty string');
    }
    if (typeof model['label'] !== 'string' || model['label'].trim().length === 0) {
      fail(`${path}.label`, 'must be a non-empty string');
    }
    const window = model['contextWindow'];
    if (window !== undefined && window !== null) {
      if (typeof window !== 'number' || !Number.isInteger(window) || window <= 0) {
        fail(`${path}.contextWindow`, 'must be a positive integer or null');
      }
    }
    const isDefault = model['isDefault'];
    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      fail(`${path}.isDefault`, 'must be a boolean');
    }
    if (isDefault === true) defaults += 1;
  });
  if (defaults > 1) fail('models', 'may mark at most one model as default');
}

function absoluteBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('baseUrl', 'is required');
  }
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    fail('baseUrl', 'must be an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail('baseUrl', 'must use http: or https:');
  }
  return trimmed;
}

function validateOpenAI(config: Record<string, unknown>): void {
  absoluteBaseUrl(config['baseUrl']);
  optionalStringRecord(config, 'headers');
  optionalString(config, 'family');
  optionalPositiveInteger(config, 'maxTokens');
  const temperature = config['temperature'];
  if (temperature !== undefined) {
    if (
      typeof temperature !== 'number' ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      fail('temperature', 'must be a finite number from 0 to 2');
    }
  }
}

function validateAnthropic(config: Record<string, unknown>): void {
  const baseUrl = config['baseUrl'];
  if (baseUrl === undefined) {
    config['baseUrl'] = DEFAULT_ANTHROPIC_BASE_URL;
  } else {
    config['baseUrl'] = absoluteBaseUrl(baseUrl);
  }
  optionalString(config, 'model');
  optionalStringRecord(config, 'headers');
}

function validateAcpLike(config: Record<string, unknown>): void {
  commandValue(config, 'command');
  commandValue(config, 'agentCommand');
  optionalStringList(config, 'args');
  optionalStringRecord(config, 'env');
  optionalString(config, 'family');
}

/**
 * Validates and normalizes the known keys for `kind`, preserving unknown keys.
 * `opencode` defaults to the `opencode acp` command when nothing is configured.
 */
export function validateProviderConfig(
  kind: ProviderKind,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (!KINDS.includes(kind)) throw badRequest(`unknown provider kind: ${kind}`);
  if (!isPlainObject(config)) throw badRequest('config must be an object');

  const normalized: Record<string, unknown> = { ...config };
  switch (kind) {
    case 'claude':
      optionalString(normalized, 'pathToClaudeCodeExecutable');
      break;
    case 'codex':
      optionalString(normalized, 'command');
      optionalString(normalized, 'model');
      break;
    case 'acp':
      validateAcpLike(normalized);
      break;
    case 'opencode':
      validateAcpLike(normalized);
      if (normalized['command'] === undefined && normalized['agentCommand'] === undefined) {
        normalized['command'] = 'opencode';
        if (normalized['args'] === undefined) normalized['args'] = ['acp'];
      }
      break;
    case 'openai-compatible':
      validateOpenAI(normalized);
      break;
    case 'anthropic':
      validateAnthropic(normalized);
      break;
    default:
      break;
  }
  validateModels(normalized);
  return normalized;
}
