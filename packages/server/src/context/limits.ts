/**
 * Token limits for one thread's model.
 *
 * Precedence follows D35: a per-model value wins, a provider preset seeds it, and the
 * contract default is the last resort. Model rows are the source of truth once a
 * provider has been refreshed; the provider config's `models` array covers rows that
 * predate per-model limits, and `provider.config.contextWindow` covers single-model
 * providers that never listed a model.
 */
import type { Model, Settings, Thread } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { DEFAULT_CONTEXT_WINDOW } from './usage.js';

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelLimitsInput {
  models: readonly Model[];
  providerConfig: Record<string, unknown>;
  modelId: string;
  settings: Settings;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** One limit from the provider config's `models` array, for rows not yet refreshed. */
function configModelLimit(
  config: Record<string, unknown>,
  modelId: string,
  key: 'contextWindow' | 'maxOutputTokens',
): number | undefined {
  const models = config['models'];
  if (!Array.isArray(models)) return undefined;
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (!('id' in entry) || entry.id !== modelId) continue;
    if (!(key in entry)) return undefined;
    return positiveInteger(entry[key]);
  }
  return undefined;
}

export function modelLimits(input: ModelLimitsInput): ModelLimits {
  const row = input.models.find((model) => model.modelId === input.modelId);
  const contextWindow =
    positiveInteger(row?.contextWindow) ??
    configModelLimit(input.providerConfig, input.modelId, 'contextWindow') ??
    positiveInteger(input.providerConfig['contextWindow']) ??
    DEFAULT_CONTEXT_WINDOW;
  const maxOutputTokens =
    positiveInteger(row?.maxOutputTokens) ??
    configModelLimit(input.providerConfig, input.modelId, 'maxOutputTokens') ??
    input.settings.maxOutputTokens;
  return { contextWindow, maxOutputTokens };
}

/** Resolves the thread's model row and provider config into the effective limits. */
export function threadLimits(repos: Repos, thread: Thread, settings: Settings): ModelLimits {
  const provider = repos.providers.get(thread.providerId);
  return modelLimits({
    models: provider === undefined ? [] : repos.providers.listModels(provider.id),
    providerConfig: provider?.config ?? {},
    modelId: thread.modelId,
    settings,
  });
}
