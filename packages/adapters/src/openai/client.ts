import {
  AdapterUnavailableError,
  type AdapterLogger,
  type ProviderConfig,
  type ToolProfile,
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
  /** A subagent child's profile; unset offers the full harness list. */
  toolProfile?: ToolProfile;
  /** Reasoning level; `none` asks the provider not to think. Unset sends nothing. */
  reasoningEffort?: string;
}

/** OpenRouter takes a `reasoning` object; every other compatible server takes `reasoning_effort`. */
export function reasoningParams(baseUrl: string, effort: string | undefined): Record<string, unknown> {
  if (effort === undefined || effort.trim().length === 0) return {};
  if (/openrouter\.ai/i.test(baseUrl)) return { reasoning: { effort } };
  return { reasoning_effort: effort };
}

/** The output-token field a request carries; newer OpenAI models reject `max_tokens`. */
export type MaxTokensField = 'max_tokens' | 'max_completion_tokens';

const NEWER_TOKEN_MODELS = /^(gpt-5|gpt-6|o1|o3|o4)/;

/**
 * Which output-token field the request must carry. Newer OpenAI models take
 * `max_completion_tokens`; every other compatible server still reads `max_tokens`.
 * An explicit `maxTokensField` in the provider config wins in either direction.
 */
export function maxTokensField(model: string, configured?: unknown): MaxTokensField {
  if (configured === 'max_completion_tokens' || configured === 'max_tokens') return configured;
  return NEWER_TOKEN_MODELS.test(model.trim().toLowerCase())
    ? 'max_completion_tokens'
    : 'max_tokens';
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAIClientConfig {
  baseUrl: string;
  headers: Record<string, string>;
  secret: string | null;
  maxTokens?: number;
  temperature?: number;
  maxTokensField?: MaxTokensField;
}

export interface OpenAIClientOptions {
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
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
const RATE_LIMIT_RETRY_DELAY = 5000;
const MAX_RATE_LIMIT_DELAY = 60000;
/**
 * One request plus four retries. A shared provider key under concurrent load answers
 * 429 or 502 for several seconds; three attempts gave up inside that window and the
 * whole turn failed. Backoff doubles per attempt (500ms to 4s), and Retry-After wins.
 */
const MAX_ATTEMPTS = 5;

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
  const rawTokensField = provider.config.maxTokensField;
  const tokensField =
    rawTokensField === 'max_tokens' || rawTokensField === 'max_completion_tokens'
      ? rawTokensField
      : undefined;
  return {
    baseUrl,
    headers,
    secret,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(tokensField !== undefined ? { maxTokensField: tokensField } : {}),
  };
}

export function toOpenAITools(
  allowlist?: readonly string[],
  options: ToolListOptions = {},
  profile?: ToolProfile,
): unknown[] {
  return allowedToolSchemas(allowlist, options, profile).map((schema: HarnessToolSchema) => ({
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

function buildBody(
  config: OpenAIClientConfig,
  request: ChatRequestBody,
  field: MaxTokensField,
  includeUsage = true,
): Record<string, unknown> {
  const tools = toOpenAITools(request.toolAllowlist, request.toolOptions ?? {}, request.toolProfile);
  const maxTokens = request.maxTokens ?? config.maxTokens;
  return {
    model: request.model,
    messages: request.messages,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(maxTokens !== undefined ? { [field]: maxTokens } : {}),
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

/** A 400 that names both fields is the provider asking for the other output-token field. */
function rejectsTokenField(excerpt: string): boolean {
  return excerpt.includes('max_tokens') && excerpt.includes('max_completion_tokens');
}

/** Shared across sessions: a 429 empties the provider bucket for every caller. */
const rateLimitCooldowns = new Map<string, number>();

function cooldownKey(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function rateLimitedBody(excerpt: string): boolean {
  return /HTTP\s*429|"code"\s*:\s*"?429"?|rate.?limit/i.test(excerpt);
}

function errorFor(status: number, excerpt: string): OpenAIRequestError {
  if (status === 401 || status === 403) {
    return new OpenAIRequestError('unauthorized (check the provider key)', status, false);
  }
  if (status === 429 || status >= 500) {
    const detail = excerpt.replace(/\s+/g, ' ').trim().slice(0, 300);
    const prefix = rateLimitedBody(excerpt)
      ? 'upstream rate limited (HTTP 429 behind status ' + status + ')'
      : 'request failed with status ' + status;
    return new OpenAIRequestError(prefix + (detail.length > 0 ? ': ' + detail : ''), status, true);
  }
  const detail = excerpt.length > 0 ? ': ' + excerpt.slice(0, 300) : '';
  return new OpenAIRequestError('request failed with status ' + status + detail, status, false);
}

function retryDelay(response: Response | null, attempt: number, rateLimited = false): number {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RATE_LIMIT_DELAY);
    }
  }
  if (rateLimited) {
    return Math.min(RATE_LIMIT_RETRY_DELAY * 2 ** (attempt - 1), MAX_RATE_LIMIT_DELAY);
  }
  return Math.min(DEFAULT_RETRY_DELAY * 2 ** (attempt - 1), MAX_RETRY_DELAY);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
}

/**
 * Node's fetch rejects a network failure with `TypeError: fetch failed`; the reason
 * (ECONNRESET, ENOTFOUND, ECONNREFUSED) sits one level down in `cause.code`.
 */
function networkDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  const code =
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
      ? cause.code
      : null;
  const message = error.message.length > 0 ? error.message : 'request failed';
  return code !== null && !message.includes(code) ? message + ' (' + code + ')' : message;
}

export class OpenAIClient implements ChatStreamer {
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly logger: AdapterLogger;

  constructor(
    private readonly config: OpenAIClientConfig,
    options: OpenAIClientOptions,
  ) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.logger = options.logger;
  }

  async stream(request: ChatRequestBody, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    let attempt = 0;
    let fieldRetried = false;
    let includeUsage = true;
    let cooldownUntil = 0;
    let field = maxTokensField(request.model, this.config.maxTokensField);
    while (true) {
      await this.waitForCooldown(cooldownUntil);
      let response: Response;
      try {
        response = await this.fetchFn(this.config.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(buildBody(this.config, request, field, includeUsage)),
          signal,
        });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        const failure = new OpenAIRequestError('network error: ' + networkDetail(error), 0, true);
        this.logger.warn('openai request failed', {
          status: 0,
          retryable: true,
          model: request.model,
          host: new URL(this.config.baseUrl).host,
          messages: request.messages.length,
          tools: toOpenAITools(request.toolAllowlist, request.toolOptions ?? {}, request.toolProfile).length,
          tokenField: field,
          reasoningEffort: request.reasoningEffort ?? null,
          error: failure.message,
        });
        if (attempt >= MAX_ATTEMPTS - 1) {
          throw new OpenAIRequestError(
            failure.message + ' after ' + (attempt + 1) + ' attempts',
            0,
            true,
          );
        }
        attempt += 1;
        await this.sleep(retryDelay(null, attempt));
        continue;
      }
      if (response.ok) {
        if (!response.body) {
          throw new OpenAIRequestError('response has no body', response.status, true);
        }
        return response.body;
      }
      const excerpt = await readExcerpt(response);
      if (response.status === 400 && !fieldRetried && rejectsTokenField(excerpt)) {
        fieldRetried = true;
        const from = field;
        field = field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
        this.logger.warn('openai rejected the output token field, retrying with the alternate', {
          from,
          to: field,
        });
        continue;
      }
      const error = errorFor(response.status, excerpt);
      const rateLimited = rateLimitedBody(excerpt);
      this.logger.warn('openai request failed', {
        status: response.status,
        retryable: error.retryable,
        model: request.model,
        host: new URL(this.config.baseUrl).host,
        messages: request.messages.length,
        tools: toOpenAITools(request.toolAllowlist, request.toolOptions ?? {}, request.toolProfile).length,
        streamOptions: includeUsage,
        tokenField: field,
        reasoningEffort: request.reasoningEffort ?? null,
        rateLimited,
        excerpt: excerpt.replace(/\s+/g, ' ').slice(0, 200),
      });
      // Some OpenAI-compatible gateways answer 5xx for stream_options. Try the next
      // attempt without it before spending the rest of the retry budget.
      if (error.retryable && response.status >= 500 && includeUsage && !rateLimited) {
        includeUsage = false;
        this.logger.warn('retrying without stream_options after a server error', {
          status: response.status,
        });
      }
      if (!error.retryable || attempt >= MAX_ATTEMPTS - 1) {
        const attempts = attempt + 1;
        const message = attempts > 1 ? `${error.message} after ${attempts} attempts` : error.message;
        throw new OpenAIRequestError(message, error.status, error.retryable);
      }
      attempt += 1;
      const delay = retryDelay(response, attempt, rateLimited);
      if (rateLimited) {
        const key = cooldownKey(this.config.baseUrl);
        const until = Date.now() + delay;
        cooldownUntil = until;
        rateLimitCooldowns.set(key, Math.max(rateLimitCooldowns.get(key) ?? 0, until));
      }
      await this.sleep(delay);
    }
  }

  /** Waits out a rate-limit window another session observed for the same base URL. */
  private async waitForCooldown(alreadyWaitedUntil: number): Promise<void> {
    const key = cooldownKey(this.config.baseUrl);
    const until = rateLimitCooldowns.get(key);
    if (until === undefined || until <= alreadyWaitedUntil) return;
    const wait = until - Date.now();
    if (wait <= 0) {
      if (rateLimitCooldowns.get(key) === until) rateLimitCooldowns.delete(key);
      return;
    }
    await this.sleep(wait + Math.floor(this.random() * 250));
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
