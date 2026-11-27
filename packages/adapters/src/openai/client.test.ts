import { describe, expect, it } from 'vitest';
import { AdapterUnavailableError, type ProviderConfig } from '@tuffcode/contracts';
import {
  OpenAIClient,
  OpenAIRequestError,
  maxTokensField,
  readClientConfig,
  type ChatRequestBody,
} from './client.js';

const request: ChatRequestBody = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
};

/** The 400 OpenAI returns for `max_tokens` on a model that wants the newer field. */
const TOKEN_FIELD_ERROR =
  '{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model. ' +
  'Use \'max_completion_tokens\' instead.","type":"invalid_request_error","param":"max_tokens",' +
  '"code":"unsupported_parameter"}}';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function provider(config: Record<string, unknown>): ProviderConfig {
  return { id: 'prov-openai', kind: 'openai-compatible', label: 'OpenAI', config, secret: null };
}

describe('readClientConfig', () => {
  it('throws AdapterUnavailableError without a baseUrl', () => {
    expect(() => readClientConfig(provider({}))).toThrow(AdapterUnavailableError);
    try {
      readClientConfig(provider({ baseUrl: '   ' }));
    } catch (error) {
      expect((error as AdapterUnavailableError).hint).toContain('baseUrl');
    }
  });

  it('strips trailing slashes and ignores non-string headers', () => {
    const config = readClientConfig(
      provider({
        baseUrl: 'http://localhost:1234/v1//',
        headers: { Authorization: 'Token x', bad: 5 },
      }),
    );
    expect(config.baseUrl).toBe('http://localhost:1234/v1');
    expect(config.headers).toEqual({ authorization: 'Token x' });
  });

  it('carries an explicit maxTokensField and ignores an unknown one', () => {
    expect(
      readClientConfig(
        provider({ baseUrl: 'http://x/v1', maxTokensField: 'max_completion_tokens' }),
      ).maxTokensField,
    ).toBe('max_completion_tokens');
    expect(
      readClientConfig(provider({ baseUrl: 'http://x/v1', maxTokensField: 'nonsense' }))
        .maxTokensField,
    ).toBeUndefined();
  });
});

describe('maxTokensField', () => {
  it('sends max_completion_tokens to newer OpenAI models', () => {
    for (const model of ['gpt-6.1-sol', 'gpt-5.2', 'GPT-6-Turbo', 'o1', 'o3-mini', 'o4-mini']) {
      expect(maxTokensField(model)).toBe('max_completion_tokens');
    }
  });

  it('keeps max_tokens for every other compatible model', () => {
    for (const model of ['mock-model', 'gpt-4o', 'claude-opus-4-5', 'qwen3-coder', '']) {
      expect(maxTokensField(model)).toBe('max_tokens');
    }
  });

  it('honours an explicit provider config value in either direction', () => {
    expect(maxTokensField('mock-model', 'max_completion_tokens')).toBe('max_completion_tokens');
    expect(maxTokensField('gpt-6.1-sol', 'max_tokens')).toBe('max_tokens');
    expect(maxTokensField('mock-model', 'nonsense')).toBe('max_tokens');
    expect(maxTokensField('gpt-6.1-sol', 5)).toBe('max_completion_tokens');
  });
});

describe('OpenAIClient', () => {
  it('retries once on 500 and sends the expected request', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sleeps: number[] = [];
    const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return calls.length === 1 ? response(500, 'boom') : response(200);
    };
    const client = new OpenAIClient(
      {
        baseUrl: 'http://127.0.0.1:1234/v1',
        headers: { 'x-extra': '1' },
        secret: 'key',
        maxTokens: 64,
        temperature: 0.2,
      },
      {
        fetchFn,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        logger,
      },
    );
    const stream = await client.stream(request, new AbortController().signal);
    expect(stream).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
    expect(calls[0]?.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer key');
    expect(headers['x-extra']).toBe('1');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(true);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(6);
    expect(body.max_tokens).toBe(64);
    expect(body.temperature).toBe(0.2);
  });

  it('offers only the allowlisted tools, and none when the allowlist is empty', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_url: string, init: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return response(200);
    };
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      { fetchFn, sleep: async () => {}, logger },
    );

    await client.stream({ ...request, toolAllowlist: ['read'] }, new AbortController().signal);
    const filtered = bodies[0]?.tools as { function: { name: string } }[];
    expect(filtered.map((tool) => tool.function.name)).toEqual(['read']);
    expect(bodies[0]?.tool_choice).toBe('auto');

    await client.stream({ ...request, toolAllowlist: [] }, new AbortController().signal);
    expect(bodies[1]?.tools).toBeUndefined();
    expect(bodies[1]?.tool_choice).toBeUndefined();
  });

  it('lets the request override the configured max tokens', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_url: string, init: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return response(200);
    };
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null, maxTokens: 64 },
      { fetchFn, sleep: async () => {}, logger },
    );

    await client.stream({ ...request, maxTokens: 512 }, new AbortController().signal);

    expect(bodies[0]?.max_tokens).toBe(512);
  });

  it('maps 401 to a non-retryable error', async () => {
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      { fetchFn: async () => response(401, 'nope'), sleep: async () => {}, logger },
    );
    try {
      await client.stream(request, new AbortController().signal);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAIRequestError);
      expect((error as OpenAIRequestError).retryable).toBe(false);
      expect((error as OpenAIRequestError).message).toContain('unauthorized');
    }
  });

  it('sends max_completion_tokens to a newer OpenAI model', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null, maxTokens: 64 },
      {
        fetchFn: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return response(200);
        },
        sleep: async () => {},
        logger,
      },
    );

    await client.stream(
      { ...request, model: 'gpt-6.1-sol', maxTokens: 512 },
      new AbortController().signal,
    );

    expect(bodies[0]?.max_completion_tokens).toBe(512);
    expect(bodies[0]?.max_tokens).toBeUndefined();
  });

  it('keeps max_tokens for a generic gateway model', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null, maxTokens: 64 },
      {
        fetchFn: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return response(200);
        },
        sleep: async () => {},
        logger,
      },
    );

    await client.stream({ ...request, model: 'mock-model' }, new AbortController().signal);

    expect(bodies[0]?.max_tokens).toBe(64);
    expect(bodies[0]?.max_completion_tokens).toBeUndefined();
  });

  it('lets the provider config force max_completion_tokens', async () => {
    const bodies: Record<string, unknown>[] = [];
    const config = readClientConfig(
      provider({ baseUrl: 'http://x/v1', maxTokens: 64, maxTokensField: 'max_completion_tokens' }),
    );
    const client = new OpenAIClient(config, {
      fetchFn: async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return response(200);
      },
      sleep: async () => {},
      logger,
    });

    await client.stream({ ...request, model: 'mock-model' }, new AbortController().signal);

    expect(bodies[0]?.max_completion_tokens).toBe(64);
    expect(bodies[0]?.max_tokens).toBeUndefined();
  });

  it('retries once with max_completion_tokens when a 400 names both fields', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null, maxTokens: 64 },
      {
        fetchFn: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return bodies.length === 1 ? response(400, TOKEN_FIELD_ERROR) : response(200);
        },
        sleep: async () => {},
        logger,
      },
    );

    const stream = await client.stream(
      { ...request, model: 'mock-model' },
      new AbortController().signal,
    );

    expect(stream).toBeDefined();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.max_tokens).toBe(64);
    expect(bodies[1]?.max_completion_tokens).toBe(64);
    expect(bodies[1]?.max_tokens).toBeUndefined();
  });

  it('surfaces one readable error when the alternate field is rejected too', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: 'sk-secret-value' },
      {
        fetchFn: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return response(400, TOKEN_FIELD_ERROR);
        },
        sleep: async () => {},
        logger,
      },
    );

    try {
      await client.stream({ ...request, model: 'mock-model' }, new AbortController().signal);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAIRequestError);
      const failure = error as OpenAIRequestError;
      expect(failure.status).toBe(400);
      expect(failure.retryable).toBe(false);
      expect(failure.message).toContain('Unsupported parameter');
      expect(failure.message).toContain('max_completion_tokens');
      expect(failure.message).not.toContain('sk-secret-value');
    }
    expect(bodies).toHaveLength(2);
  });

  it('retries a 502 twice with doubling backoff and then streams', async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async () => {
          calls += 1;
          return calls <= 2 ? response(502) : response(200);
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
        logger,
      },
    );

    const stream = await client.stream(request, new AbortController().signal);

    expect(stream).toBeDefined();
    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('drops stream_options after a 5xx and recovers', async () => {
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          calls += 1;
          return calls === 1 ? response(502, 'upstream overloaded') : response(200);
        },
        sleep: async () => {},
        logger,
      },
    );

    const stream = await client.stream(request, new AbortController().signal);

    expect(stream).toBeDefined();
    expect(calls).toBe(2);
    expect(bodies[0]?.['stream_options']).toEqual({ include_usage: true });
    expect(bodies[1]).not.toHaveProperty('stream_options');
  });

  it('recovers on the fifth attempt after four 502s', async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async () => {
          calls += 1;
          return calls <= 4 ? response(502) : response(200);
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
        logger,
      },
    );

    const stream = await client.stream(request, new AbortController().signal);

    expect(stream).toBeDefined();
    expect(calls).toBe(5);
    expect(delays).toEqual([500, 1000, 2000, 4000]);
  });

  it('gives up after five retryable failures with the full backoff', async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async () => {
          calls += 1;
          return response(502, '{"error":{"message":"upstream failed"}}');
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
        logger,
      },
    );

    const failure = await client
      .stream(request, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 502, retryable: true });
    expect(calls).toBe(5);
    expect(delays).toEqual([500, 1000, 2000, 4000]);
    expect((failure as Error).message).toContain('upstream failed');
    expect((failure as Error).message).toContain('after 5 attempts');
  });

  it('honors Retry-After over the default backoff', async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async () => {
          calls += 1;
          return calls === 1
            ? response(429, '', { 'retry-after': '2' })
            : response(200);
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
        logger,
      },
    );

    await client.stream(request, new AbortController().signal);

    expect(delays).toEqual([2000]);
  });

  it('does not retry a 400 that is not about the output token field', async () => {
    let calls = 0;
    const client = new OpenAIClient(
      { baseUrl: 'http://x/v1', headers: {}, secret: null },
      {
        fetchFn: async () => {
          calls += 1;
          return response(400, '{"error":{"message":"model does not exist"}}');
        },
        sleep: async () => {},
        logger,
      },
    );

    try {
      await client.stream({ ...request, model: 'mock-model' }, new AbortController().signal);
      expect.unreachable();
    } catch (error) {
      expect((error as OpenAIRequestError).message).toContain('model does not exist');
    }
    expect(calls).toBe(1);
  });
});
