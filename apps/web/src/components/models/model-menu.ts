import type { Model, ProviderView } from '@tuffcode/contracts';

/** Pure rules for the composer's model menu. */
export const OFF_EFFORT = 'none';
export const DEFAULT_LADDER = ['low', 'medium', 'high', 'xhigh'] as const;

/** Providers the menu lists: enabled ones, the thread's own first. */
export function menuProviders(providers: readonly ProviderView[], currentId: string | undefined): ProviderView[] {
  const enabled = providers.filter((provider) => provider.enabled);
  return enabled.toSorted((left, right) => {
    if (left.id === currentId) return -1;
    if (right.id === currentId) return 1;
    return left.label.localeCompare(right.label);
  });
}

/**
 * Levels the effort row offers for a model: off always, then what the model reports,
 * else the standard ladder for a reasoning model, else nothing more. A provider's
 * configured list wins over the model's when both exist.
 */
export function effortChoices(model: Model | undefined, providerEfforts: readonly string[] = []): string[] {
  const reported =
    providerEfforts.length > 0
      ? providerEfforts
      : (model?.capabilities?.reasoningEfforts ?? []).length > 0
        ? (model?.capabilities?.reasoningEfforts ?? [])
        : model?.capabilities?.reasoning === true
          ? DEFAULT_LADDER
          : [];
  const out = [OFF_EFFORT];
  for (const level of reported) if (level !== OFF_EFFORT && !out.includes(level)) out.push(level);
  return out;
}

export function effortText(level: string | null): string {
  if (level === null) return 'Auto';
  return level === OFF_EFFORT ? 'Off' : level.charAt(0).toUpperCase() + level.slice(1);
}

export function providerEffortsOf(provider: ProviderView | undefined): string[] {
  const raw = provider?.config.capabilities?.reasoningEfforts;
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function filterMenuModels(models: readonly Model[], query: string): Model[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...models];
  return models.filter(
    (model) => model.modelId.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle),
  );
}
