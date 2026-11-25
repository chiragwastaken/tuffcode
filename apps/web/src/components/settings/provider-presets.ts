import {
  ModelCapabilitiesSchema,
  ReasoningEffortSchema,
  type ModelCapabilities,
  type ProviderKind,
  type ProviderView,
  type ReasoningEffort,
} from '@tuffcode/contracts';

export type ProviderGroup = 'subscriptions' | 'api' | 'local' | 'agents';

export type ProviderAuthMode = 'subscription' | 'api-key' | 'local' | 'cli';

export type ProviderIconKey =
  | 'sparkles'
  | 'bot'
  | 'gem'
  | 'wind'
  | 'flame'
  | 'hard-drive'
  | 'server'
  | 'laptop'
  | 'terminal'
  | 'plug'
  | 'wrench'
  | 'cloud'
  | 'braces'
  | 'moon'
  | 'users'
  | 'key';

export interface PresetModel {
  id: string;
  label: string;
  /** Tokens the model can hold; seeded by the preset, overridable per model. */
  contextWindow?: number | null;
  /** Tokens the model may answer with; seeded by the preset, overridable per model. */
  maxOutputTokens?: number | null;
  /** What the model can do; carried through the seed when the row has it. */
  capabilities?: ModelCapabilities | null;
  /** Reasoning effort the model starts with; carried through the seed when set. */
  reasoningEffort?: ReasoningEffort | null;
}

export interface ProviderPreset {
  id: string;
  group: ProviderGroup;
  kind: ProviderKind;
  label: string;
  description: string;
  auth: ProviderAuthMode;
  icon: ProviderIconKey;
  /** Fixed endpoint for hosted API presets; prefilled default for local presets. */
  baseUrl?: string;
  /** Models offered by the picker. Local presets may be empty and rely on Detect. */
  models: readonly PresetModel[];
  defaultModel?: string;
  docsUrl?: string;
  /** A new provider of this preset needs a secret before it can be used. */
  requiresSecret?: boolean;
  /** The custom card starts on the full form instead of a preset-only form. */
  custom?: boolean;
  /** Council family for OpenAI-compatible providers. */
  family?: string;
  /** Default token limits seeded into every model of this preset. */
  contextWindow?: number;
  maxOutputTokens?: number;
  /** What models of this preset can do; seeded into the provider config. */
  capabilities?: ModelCapabilities;
  /** Reasoning effort this preset starts with; the advanced form overrides it. */
  reasoningEffort?: ReasoningEffort;
  /** Headers the endpoint requires, prefilled into the form's header field. */
  headers?: Readonly<Record<string, string>>;
}

export interface ProviderGroupMeta {
  id: ProviderGroup;
  title: string;
  description: string;
}

export const PROVIDER_GROUPS: readonly ProviderGroupMeta[] = [
  {
    id: 'subscriptions',
    title: 'Subscriptions',
    description: 'Use a vendor CLI and the plan you already pay for. No API key.',
  },
  {
    id: 'api',
    title: 'API providers',
    description: 'Run hosted models with your own API key.',
  },
  {
    id: 'local',
    title: 'Local',
    description: 'Models served on this machine. No key, no cloud round trip.',
  },
  {
    id: 'agents',
    title: 'Agents',
    description: 'Local agent CLIs that speak ACP over stdio.',
  },
];

function models(...ids: string[]): PresetModel[] {
  return ids.map((id) => ({ id, label: id }));
}

const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * Every preset advertises tool use. Reasoning presets also list the efforts
 * their endpoint accepts; the advanced form can override both.
 */
function presetCapabilities(reasoning = false): ModelCapabilities {
  return {
    tools: true,
    vision: false,
    reasoning,
    reasoningEfforts: reasoning ? [...REASONING_EFFORTS] : [],
  };
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'claude',
    group: 'subscriptions',
    kind: 'claude',
    label: 'Claude',
    description: 'Claude Pro or Max through the Claude Code CLI.',
    auth: 'subscription',
    icon: 'sparkles',
    models: models('claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'),
    defaultModel: 'claude-opus-4-5',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    capabilities: presetCapabilities(true),
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'chatgpt',
    group: 'subscriptions',
    kind: 'codex',
    label: 'ChatGPT',
    description: 'ChatGPT Plus or Pro through the Codex CLI.',
    auth: 'subscription',
    icon: 'bot',
    models: models('gpt-5-codex', 'gpt-5.1', 'gpt-5'),
    defaultModel: 'gpt-5-codex',
    docsUrl: 'https://developers.openai.com/codex/cli/',
    capabilities: presetCapabilities(),
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  },
  {
    id: 'anthropic-api',
    group: 'api',
    kind: 'anthropic',
    label: 'Anthropic API',
    description: 'Claude models with an Anthropic API key.',
    auth: 'api-key',
    icon: 'sparkles',
    baseUrl: 'https://api.anthropic.com/v1',
    models: models('claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'),
    defaultModel: 'claude-sonnet-4-5',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'openai',
    group: 'api',
    kind: 'openai-compatible',
    label: 'OpenAI',
    description: 'GPT models from the OpenAI platform.',
    auth: 'api-key',
    icon: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    models: models('gpt-5.1', 'gpt-5', 'gpt-5-mini'),
    defaultModel: 'gpt-5.1',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  },
  {
    id: 'openrouter',
    group: 'api',
    kind: 'openai-compatible',
    label: 'OpenRouter',
    description: 'One key for many hosted model vendors.',
    auth: 'api-key',
    icon: 'braces',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: models(
      'openai/gpt-5.1',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
    ),
    defaultModel: 'openai/gpt-5.1',
    docsUrl: 'https://openrouter.ai/docs',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'openrouter',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'deepseek',
    group: 'api',
    kind: 'openai-compatible',
    label: 'DeepSeek',
    description: 'DeepSeek chat and reasoning models.',
    auth: 'api-key',
    icon: 'braces',
    baseUrl: 'https://api.deepseek.com/v1',
    models: models('deepseek-chat', 'deepseek-reasoner'),
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://api-docs.deepseek.com',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'deepseek',
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'kimi',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Moonshot Kimi',
    description: 'Kimi long-context models from Moonshot.',
    auth: 'api-key',
    icon: 'moon',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: models('kimi-k2-0905-preview', 'kimi-k2-turbo-preview'),
    defaultModel: 'kimi-k2-0905-preview',
    docsUrl: 'https://platform.moonshot.ai/docs',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'moonshot',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'groq',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Groq',
    description: 'Very fast inference for open models.',
    auth: 'api-key',
    icon: 'wind',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: models('llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct'),
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/docs/openai',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'groq',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'mistral',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Mistral',
    description: 'Mistral and Codestral models.',
    auth: 'api-key',
    icon: 'wind',
    baseUrl: 'https://api.mistral.ai/v1',
    models: models('mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'),
    defaultModel: 'mistral-large-latest',
    docsUrl: 'https://docs.mistral.ai/api',
    capabilities: presetCapabilities(),
    requiresSecret: true,
    family: 'mistral',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'xai',
    group: 'api',
    kind: 'openai-compatible',
    label: 'xAI',
    description: 'Grok models from the xAI API.',
    auth: 'api-key',
    icon: 'flame',
    baseUrl: 'https://api.x.ai/v1',
    models: models('grok-4', 'grok-3', 'grok-code-fast-1'),
    defaultModel: 'grok-4',
    docsUrl: 'https://docs.x.ai/docs/api-reference',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'xai',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'together',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Together',
    description: 'Hosted open-weight models from Together AI.',
    auth: 'api-key',
    icon: 'users',
    baseUrl: 'https://api.together.xyz/v1',
    models: models(
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ),
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    capabilities: presetCapabilities(),
    requiresSecret: true,
    family: 'together',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'gemini',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Google Gemini',
    description: 'Gemini through the OpenAI-compatible endpoint.',
    auth: 'api-key',
    icon: 'gem',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: models('gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview'),
    defaultModel: 'gemini-2.5-pro',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    capabilities: presetCapabilities(true),
    requiresSecret: true,
    family: 'google',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'copilot',
    group: 'api',
    kind: 'openai-compatible',
    label: 'GitHub Copilot',
    description: 'Copilot chat models with a GitHub token and the editor headers.',
    auth: 'api-key',
    icon: 'key',
    baseUrl: 'https://api.githubcopilot.com',
    models: models('gpt-4o', 'claude-sonnet-4', 'o3-mini'),
    defaultModel: 'gpt-4o',
    docsUrl: 'https://docs.github.com/en/copilot',
    capabilities: presetCapabilities(),
    requiresSecret: true,
    family: 'github-copilot',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    headers: {
      'Editor-Version': 'vscode/1.99.0',
      'Copilot-Integration-Id': 'vscode-chat',
    },
  },
  {
    id: 'azure-openai',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Azure OpenAI',
    description: 'Your Azure deployment: replace the resource and deployment in the URL.',
    auth: 'api-key',
    icon: 'cloud',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    models: models('gpt-4o', 'gpt-4.1', 'o3-mini'),
    defaultModel: 'gpt-4o',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/reference',
    capabilities: presetCapabilities(),
    requiresSecret: true,
    custom: true,
    family: 'azure-openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    headers: { 'api-version': '2024-10-21' },
  },
  {
    id: 'ollama',
    group: 'local',
    kind: 'openai-compatible',
    label: 'Ollama',
    description: 'Local models served by Ollama.',
    auth: 'local',
    icon: 'hard-drive',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: models('qwen3-coder', 'llama3.3', 'deepseek-r1'),
    defaultModel: 'qwen3-coder',
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    capabilities: presetCapabilities(),
    family: 'local',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
  },
  {
    id: 'lmstudio',
    group: 'local',
    kind: 'openai-compatible',
    label: 'LM Studio',
    description: 'Models loaded in LM Studio on this machine.',
    auth: 'local',
    icon: 'laptop',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: models('qwen3-coder', 'gpt-oss-20b'),
    defaultModel: 'qwen3-coder',
    docsUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
    capabilities: presetCapabilities(),
    family: 'local',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
  },
  {
    id: 'vllm',
    group: 'local',
    kind: 'openai-compatible',
    label: 'vLLM',
    description: 'A vLLM server you run yourself.',
    auth: 'local',
    icon: 'server',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: [],
    docsUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    capabilities: presetCapabilities(),
    family: 'local',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
  },
  {
    id: 'opencode',
    group: 'agents',
    kind: 'opencode',
    label: 'OpenCode',
    description: 'The OpenCode agent over ACP.',
    auth: 'cli',
    icon: 'terminal',
    models: [],
    docsUrl: 'https://opencode.ai/docs',
    capabilities: presetCapabilities(),
  },
  {
    id: 'acp',
    group: 'agents',
    kind: 'acp',
    label: 'Custom ACP agent',
    description: 'Any agent that speaks ACP over stdio.',
    auth: 'cli',
    icon: 'plug',
    models: [],
    docsUrl: 'https://agentclientprotocol.com',
    capabilities: presetCapabilities(),
  },
  {
    id: 'custom-openai',
    group: 'api',
    kind: 'openai-compatible',
    label: 'Custom OpenAI-compatible',
    description: 'Any endpoint that implements the OpenAI API.',
    auth: 'api-key',
    icon: 'wrench',
    models: [],
    custom: true,
    capabilities: presetCapabilities(),
    family: 'openai-compatible',
  },
];

const PRESETS_BY_ID = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

export const CUSTOM_OPENAI_PRESET: ProviderPreset = PRESETS_BY_ID.get('custom-openai')!;

export function presetById(id: string | undefined | null): ProviderPreset | undefined {
  if (!id) return undefined;
  return PRESETS_BY_ID.get(id);
}

export function presetsInGroup(group: ProviderGroup): readonly ProviderPreset[] {
  return PROVIDER_PRESETS.filter((preset) => preset.group === group);
}

export function isSubscriptionKind(kind: ProviderKind): boolean {
  return kind === 'claude' || kind === 'codex';
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function isLoopbackBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

/**
 * The preset a stored provider came from. New rows record `config.preset`; older
 * rows are inferred from their kind and endpoint so grouping and badges still work.
 */
export function presetForProvider(provider: ProviderView): ProviderPreset | undefined {
  const configured = presetById(
    typeof provider.config.preset === 'string' ? provider.config.preset : undefined,
  );
  if (configured) return configured;

  switch (provider.kind) {
    case 'claude':
      return PRESETS_BY_ID.get('claude');
    case 'codex':
      return PRESETS_BY_ID.get('chatgpt');
    case 'anthropic':
      return PRESETS_BY_ID.get('anthropic-api');
    case 'opencode':
      return PRESETS_BY_ID.get('opencode');
    case 'acp':
      return PRESETS_BY_ID.get('acp');
    case 'openai-compatible': {
      const baseUrl = typeof provider.config.baseUrl === 'string' ? provider.config.baseUrl : '';
      const normalized = normalizedBaseUrl(baseUrl);
      const matching = PROVIDER_PRESETS.find(
        (preset) =>
          preset.baseUrl !== undefined &&
          normalizedBaseUrl(preset.baseUrl) === normalized &&
          preset.id !== 'custom-openai',
      );
      if (matching) return matching;
      return isLoopbackBaseUrl(baseUrl)
        ? PRESETS_BY_ID.get('vllm')
        : PRESETS_BY_ID.get('custom-openai');
    }
    default:
      return undefined;
  }
}

export function providerGroup(provider: ProviderView): ProviderGroup {
  const preset = presetForProvider(provider);
  if (preset) return preset.group;
  return isSubscriptionKind(provider.kind) ? 'subscriptions' : 'api';
}

export function providerAuthMode(provider: ProviderView): ProviderAuthMode {
  const preset = presetForProvider(provider);
  if (preset) return preset.auth;
  return isSubscriptionKind(provider.kind) ? 'subscription' : 'api-key';
}

export function authModeLabel(mode: ProviderAuthMode): string {
  switch (mode) {
    case 'subscription':
      return 'Subscription';
    case 'api-key':
      return 'API key';
    case 'local':
      return 'Local';
    case 'cli':
      return 'Local CLI';
  }
}

export function providerKindLabel(kind: ProviderKind): string {
  switch (kind) {
    case 'claude':
      return 'Claude CLI';
    case 'codex':
      return 'Codex CLI';
    case 'anthropic':
      return 'Anthropic API';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    case 'acp':
      return 'ACP agent';
    case 'opencode':
      return 'OpenCode';
  }
}

export function providerModels(provider: ProviderView): PresetModel[] {
  const configured = provider.config.models;
  if (Array.isArray(configured)) {
    const entries: PresetModel[] = [];
    for (const entry of configured) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      if (!id) continue;
      const label = typeof record.label === 'string' && record.label ? record.label : id;
      const contextWindow =
        typeof record.contextWindow === 'number' &&
        Number.isInteger(record.contextWindow) &&
        record.contextWindow > 0
          ? record.contextWindow
          : undefined;
      const maxOutputTokens =
        typeof record.maxOutputTokens === 'number' &&
        Number.isInteger(record.maxOutputTokens) &&
        record.maxOutputTokens > 0
          ? record.maxOutputTokens
          : undefined;
      const parsedCapabilities = ModelCapabilitiesSchema.safeParse(record.capabilities);
      const parsedEffort = ReasoningEffortSchema.safeParse(record.reasoningEffort);
      entries.push({
        id,
        label,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(parsedCapabilities.success ? { capabilities: parsedCapabilities.data } : {}),
        ...(parsedEffort.success ? { reasoningEffort: parsedEffort.data } : {}),
      });
    }
    if (entries.length > 0) return entries;
  }
  const model = typeof provider.config.model === 'string' ? provider.config.model.trim() : '';
  return model ? [{ id: model, label: model }] : [];
}

export function defaultModelOf(provider: ProviderView): string {
  const configured = provider.config.model;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();

  const configuredModels = provider.config.models;
  if (Array.isArray(configuredModels)) {
    const records = configuredModels.filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    );
    const preferred =
      records.find((entry) => entry.isDefault === true) ??
      records.find((entry) => typeof entry.id === 'string');
    if (preferred && typeof preferred.id === 'string') return preferred.id;
  }

  return presetForProvider(provider)?.defaultModel ?? '';
}

/** The config directory environment the vendor CLI reads, for the advanced field. */
export function configDirLabel(kind: ProviderKind): string {
  return kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
}
