import { describe, expect, it } from 'vitest';
import { AdapterUnavailableError, type ProviderConfig } from '@tuffcode/contracts';
import {
  OpenAIClient,
  OpenAIRequestError,
  readClientConfig,
  type ChatRequestBody,
} from './client.js';

const request: ChatRequestBody = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
};

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
});
