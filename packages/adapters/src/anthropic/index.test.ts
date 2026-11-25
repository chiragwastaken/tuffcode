import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AdapterUnavailableError,
  type AdapterDeps,
  type AdapterEvent,
  type AdapterLogger,
  type TurnContext,
} from '@tuffcode/contracts';
import { createAnthropicAdapter } from './index.js';

const LF = String.fromCharCode(10);
const encoder = new TextEncoder();

const logger: AdapterLogger = { debug() {}, info() {}, warn() {}, error() {} };
const deps: AdapterDeps = { logger, resolveCommand: async () => null, env: {} };

let root: string;

function context(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    turnId: 'turn_1',
    cwd: root,
    systemPrompt: 'You are Tuffcode.',
    permissionMode: 'full-auto',
    model: 'claude-test',
    brainSlice: 'brain',
    attachments: [],
    vision: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

interface FixtureEvent {
  event: string;
  data: unknown;
}

function fixture(name: string): FixtureEvent[] {
  const url = new URL('../fixtures/anthropic/' + name + '.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as FixtureEvent[];
}

function streamOf(events: FixtureEvent[]): ReadableStream<Uint8Array> {
  const text = events
    .map((entry) => 'event: ' + entry.event + LF + 'data: ' + JSON.stringify(entry.data) + LF + LF)
    .join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collect(iterable: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tuffcode-anthropic-adapter-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('createAnthropicAdapter', () => {
  it('throws AdapterUnavailableError when the API key is missing', async () => {
    const failure = await createAnthropicAdapter(
      {
        id: 'prov-a',
        kind: 'anthropic',
        label: 'Anthropic',
        config: { model: 'claude-test' },
        secret: null,
      },
      deps,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdapterUnavailableError);
    expect((failure as AdapterUnavailableError).providerId).toBe('prov-a');
  });

  it('runs two turns against a fake fetch and keeps the message history', async () => {
    const bodies: Record<string, unknown>[] = [];
    const responses = [
      streamOf(fixture('tool-use-stream')),
      streamOf(fixture('text-stream')),
      streamOf(fixture('text-stream')),
    ];
    const fetchFn = async (_input: string, init: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const next = responses.shift();
      if (next === undefined) throw new Error('unexpected fetch');
      return new Response(next, { status: 200 });
    };
    const adapter = await createAnthropicAdapter(
      {
        id: 'prov-a',
        kind: 'anthropic',
        label: 'Anthropic',
        config: { model: 'claude-config' },
        secret: 'sk-ant-test',
      },
      deps,
      { fetchFn },
    );

    expect(adapter.id.startsWith('sess_')).toBe(true);
    expect(adapter.capabilities).toEqual({
      tools: true,
      approvals: true,
      resume: false,
      models: false,
    });

    const first = await collect(adapter.send('go', context()));
    expect(first.at(-1)).toMatchObject({ type: 'turn.finished', reason: 'complete' });
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hello');

    const second = await collect(adapter.send('again', context({ turnId: 'turn_2' })));
    expect(second.at(-1)).toMatchObject({ type: 'turn.finished', reason: 'complete' });
    expect(second).toContainEqual({ type: 'text.delta', turnId: 'turn_2', text: 'Hel' });

    expect(bodies).toHaveLength(3);
    expect(bodies[0]?.model).toBe('claude-test');
    expect(bodies[0]?.max_tokens).toBe(8192);
    expect(bodies[0]?.system).toBe('You are Tuffcode.' + LF + LF + 'brain');
    const tools = bodies[0]?.tools as unknown[];
    expect(tools).toHaveLength(6);

    const lastMessages = bodies.at(-1)?.messages as { role: string }[];
    expect(lastMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    await adapter.dispose();
  });

  it('falls back to the configured model when the turn carries none', async () => {
    const bodies: Record<string, unknown>[] = [];
    const adapter = await createAnthropicAdapter(
      {
        id: 'prov-a',
        kind: 'anthropic',
        label: 'Anthropic',
        config: { model: 'claude-config' },
        secret: 'sk-ant-test',
      },
      deps,
      {
        fetchFn: async (_input: string, init: RequestInit): Promise<Response> => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response(streamOf(fixture('text-stream')), { status: 200 });
        },
      },
    );

    await collect(adapter.send('go', context({ model: '' })));
    expect(bodies[0]?.model).toBe('claude-config');
    await adapter.dispose();
  });
});
