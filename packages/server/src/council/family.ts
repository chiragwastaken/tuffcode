import type { Model, ProviderKind, ProviderView } from '@tuffcode/contracts';

export interface ReviewerSelection {
  providerId: string;
  modelId: string;
  family: string;
  authorFamily: string;
  /** True when no configured provider has a different family; the UI labels it. */
  sameFamily: boolean;
}

export interface ReviewerInput {
  providers: readonly ProviderView[];
  models: (providerId: string) => readonly Model[];
  authorProviderId: string;
  authorModelId: string;
}

/**
 * Model family for cross-model review. `claude` and `codex` are fixed; the other
 * kinds read the provider config `family` field, falling back to the kind itself so
 * an unconfigured provider still compares distinctly.
 */
export function providerFamily(kind: ProviderKind, config: Record<string, unknown>): string {
  const raw = config['family'];
  const configured = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (kind) {
    case 'claude':
      return 'anthropic';
    case 'codex':
      return 'openai';
    case 'openai-compatible':
      return configured.length > 0 ? configured : 'openai-compatible';
    case 'acp':
    case 'opencode':
      return configured.length > 0 ? configured : kind;
    default:
      return configured.length > 0 ? configured : kind;
  }
}

/**
 * Picks a reviewer whose family differs from the author's. Providers without a
 * stored model cannot run a review, so they are skipped. When no different family
 * is configured, the author's own provider and model are used for a fresh session
 * and `sameFamily` marks the review for the UI.
 */
export function selectReviewer(input: ReviewerInput): ReviewerSelection {
  const author = input.providers.find((provider) => provider.id === input.authorProviderId);
  const authorFamily =
    author === undefined ? 'unknown' : providerFamily(author.kind, author.config);

  for (const provider of input.providers) {
    if (!provider.enabled || provider.id === input.authorProviderId) continue;
    const family = providerFamily(provider.kind, provider.config);
    if (family === authorFamily) continue;
    const models = input.models(provider.id);
    const model = models.find((entry) => entry.isDefault) ?? models[0];
    if (model === undefined) continue;
    return {
      providerId: provider.id,
      modelId: model.modelId,
      family,
      authorFamily,
      sameFamily: false,
    };
  }

  return {
    providerId: input.authorProviderId,
    modelId: input.authorModelId,
    family: authorFamily,
    authorFamily,
    sameFamily: true,
  };
}
