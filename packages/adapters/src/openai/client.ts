import {
  AdapterUnavailableError,
  type AdapterLogger,
  type ProviderConfig,
} from '@tuffcode/contracts';
import type { HarnessToolSchema, ToolListOptions } from '../tool-policy.js';
import { allowedToolSchemas } from '../tool-policy.js';

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** One part of a multimodal user message; images arrive as a base64 data URL. */
export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  /** Per-turn output cap; overrides the client config when set. */
  maxTokens?: number;
  /** Settings allowlist for this turn; unset offers every harness tool. */
  toolAllowlist?: string[];
  /** Server tools offered this turn; unset offers none. */
  toolOptions?: ToolListOptions;
  /** Reasoning level; `none` asks the provider not to think. Unset sends nothing. */
  reasoningEffort?: string;
}

/** OpenRouter takes a `reasoning` object; every other compatible server takes `reasoning_effort`. */
export function reasoningParams(baseUrl: string, effort: string | undefined): Record<string, unknown> {
  if (effort === undefined || effort.trim().length === 0) return {};
  if (/openrouter\.ai/i.test(baseUrl)) return { reasoning: { effort } };
  return { reasoning_effort: effort };
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAIClientConfig {
  baseUrl: string;
  headers: Record<string, string>;
  secret: string | null;
  maxTokens?: number;
  temperature?: number;
}

export interface OpenAIClientOptions {
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  logger: AdapterLogger;
}

export interface ChatStreamer {
  stream(request: ChatRequestBody, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export class OpenAIRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'OpenAIRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

const MAX_ERROR_BYTES = 4096;
const MAX_RETRY_DELAY = 10000;
const DEFAULT_RETRY_DELAY = 500;

export function readClientConfig(provider: ProviderConfig): OpenAIClientConfig {
  const rawBase = provider.config.baseUrl;
  const baseUrl = typeof rawBase === 'string' ? rawBase.trim().replace(/\/+$/, '') : '';
  if (baseUrl.length === 0) {
    throw new AdapterUnavailableError(
      provider.id,
      'Set the provider baseUrl, for example http://127.0.0.1:1234/v1',
    );
  }

  const headers: Record<string, string> = {};
  const rawHeaders = provider.config.headers;
  if (typeof rawHeaders === 'object' && rawHeaders !== null) {
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value === 'string') headers[key.toLowerCase()] = value;
    }
  }

  const secret =
    typeof provider.secret === 'string' && provider.secret.length > 0 ? provider.secret : null;
  const rawMaxTokens = provider.config.maxTokens;
  const rawTemperature = provider.config.temperature;
  const maxTokens =
    typeof rawMaxTokens === 'number' && Number.isFinite(rawMaxTokens) ? rawMaxTokens : undefined;
  const temperature =
    typeof rawTemperature === 'number' && Number.isFinite(rawTemperature)
      ? rawTemperature
      : undefined;
  return {
    baseUrl,
    headers,
    secret,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

export function toOpenAITools(
  allowlist?: readonly string[],
  options: ToolListOptions = {},
): unknown[] {
  return allowedToolSchemas(allowlist, options).map((schema: HarnessToolSchema) => ({
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

function buildBody(config: OpenAIClientConfig, request: ChatRequestBody): Record<string, unknown> {
  const tools = toOpenAITools(request.toolAllowlist, request.toolOptions ?? {});
  const maxTokens = request.maxTokens ?? config.maxTokens;
  return {
    model: request.model,
    messages: request.messages,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...reasoningParams(config.baseUrl, request.reasoningEffort),
  };
}

async function readExcerpt(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, MAX_ERROR_BYTES).trim();
  } catch {
    return '';
  }
}

async function mapResponseError(response: Response): Promise<OpenAIRequestError> {
  const status = response.status;
  const excerpt = await readExcerpt(response);
  if (status === 401 || status === 403) {
    return new OpenAIRequestError('unauthorized (check the provider key)', status, false);
  }
  if (status === 429 || status >= 500) {
    return new OpenAIRequestError('request failed with status ' + status, status, true);
  }
  const detail = excerpt.length > 0 ? ': ' + excerpt.slice(0, 300) : '';
  return new OpenAIRequestError('request failed with status ' + status + detail, status, false);
}

function retryDelay(response: Response): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY);
    }
  }
  return DEFAULT_RETRY_DELAY;
}

export class OpenAIClient implements ChatStreamer {
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: AdapterLogger;

  constructor(
    private readonly config: OpenAIClientConfig,
    options: OpenAIClientOptions,
  ) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.logger = options.logger;
  }

  async stream(request: ChatRequestBody, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    let attempt = 0;
    while (true) {
      const response = await this.fetchFn(this.config.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(buildBody(this.config, request)),
        signal,
      });
      if (response.ok) {
        if (!response.body) {
          throw new OpenAIRequestError('response has no body', response.status, true);
        }
        return response.body;
      }
      const error = await mapResponseError(response);
      this.logger.warn('openai request failed', {
        status: response.status,
        retryable: error.retryable,
      });
      if (!error.retryable || attempt >= 1) throw error;
      attempt += 1;
      await this.sleep(retryDelay(response));
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (this.config.secret !== null) {
      headers.authorization = 'Bearer ' + this.config.secret;
    }
    return { ...headers, ...this.config.headers };
  }
}
