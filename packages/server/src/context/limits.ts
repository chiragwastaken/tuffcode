/**
 * Token limits for one thread's model.
 *
 * Precedence follows D35: a per-model value wins, a provider preset seeds it, and the
 * contract default is the last resort. Model rows are the source of truth once a
 * provider has been refreshed; the provider config's `models` array covers rows that
 * predate per-model limits, and `provider.config.contextWindow` covers single-model
 * providers that never listed a model. D46 adds `source`, so a 200k default is never
 * presented as if the provider declared it.
 */
import type { Model, Settings, Thread } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { DEFAULT_CONTEXT_WINDOW } from './usage.js';

/** Which precedence step supplied the context window. */
export type LimitSource = 'model' | 'config' | 'settings' | 'default';

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
  /** The step that supplied `contextWindow`; `maxOutputTokens` keeps its own precedence. */
  source: LimitSource;
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

function contextWindowWithSource(
  input: ModelLimitsInput,
  row: Model | undefined,
): { contextWindow: number; source: LimitSource } {
  const fromModel = positiveInteger(row?.contextWindow);
  if (fromModel !== undefined) return { contextWindow: fromModel, source: 'model' };
  const fromConfigModel = configModelLimit(input.providerConfig, input.modelId, 'contextWindow');
  if (fromConfigModel !== undefined) return { contextWindow: fromConfigModel, source: 'config' };
  const fromConfig = positiveInteger(input.providerConfig['contextWindow']);
  if (fromConfig !== undefined) return { contextWindow: fromConfig, source: 'config' };
  return { contextWindow: DEFAULT_CONTEXT_WINDOW, source: 'default' };
}

export function modelLimits(input: ModelLimitsInput): ModelLimits {
  const row = input.models.find((model) => model.modelId === input.modelId);
  const { contextWindow, source } = contextWindowWithSource(input, row);
  const maxOutputTokens =
    positiveInteger(row?.maxOutputTokens) ??
    configModelLimit(input.providerConfig, input.modelId, 'maxOutputTokens') ??
    input.settings.maxOutputTokens;
  return { contextWindow, maxOutputTokens, source };
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

/**
 * True when the thread's model can read images. The model row wins; a provider the user
 * marked as vision capable answers for a model row that never declared capabilities,
 * because discovery leaves them null for endpoints that publish no modality hints.
 */
export function threadVision(repos: Repos, thread: Thread): boolean {
  const provider = repos.providers.get(thread.providerId);
  if (provider === undefined) return false;
  const row = repos.providers.listModels(provider.id).find((m) => m.modelId === thread.modelId);
  if (row?.capabilities !== null && row?.capabilities !== undefined) {
    return row.capabilities.vision;
  }
  return providerCapabilityFlag(provider.config, 'vision');
}

/** One boolean out of a provider's `capabilities` object; false when absent or malformed. */
function providerCapabilityFlag(config: Record<string, unknown>, key: string): boolean {
  const capabilities = config['capabilities'];
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const value = (capabilities as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : false;
}
