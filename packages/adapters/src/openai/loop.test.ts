import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterDeps, AdapterEvent, AdapterLogger, TurnContext } from '@tuffcode/contracts';
import type { ChatMessage, ChatRequestBody, ChatStreamer } from './client.js';
import { createOpenAIChatAdapter } from './index.js';
import { runTurn } from './loop.js';
import { createToolSessionState } from './tools.js';

const LF = String.fromCharCode(10);
const DONE = 'data: ' + String.fromCharCode(91, 68, 79, 78, 69, 93) + LF + LF;
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
    model: 'test-model',
    brainSlice: '',
    attachments: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

function fixture(name: string): unknown[] {
  const url = new URL('../fixtures/openai/' + name + '.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown[];
}

function streamOf(payloads: unknown[]): ReadableStream<Uint8Array> {
  const text = payloads.map((payload) => 'data: ' + JSON.stringify(payload) + LF + LF).join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text + DONE));
      controller.close();
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tuffcode-openai-loop-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

class FakeClient implements ChatStreamer {
  readonly requests: ChatRequestBody[] = [];
  private index = 0;

  constructor(private readonly streams: ReadableStream<Uint8Array>[]) {}

  async stream(request: ChatRequestBody): Promise<ReadableStream<Uint8Array>> {
    this.requests.push(request);
    const next = this.streams[this.index];
    this.index += 1;
    if (next === undefined) throw new Error('unexpected request');
    return next;
  }
}

async function collect(iterable: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('runTurn', () => {
  it('accumulates tool call deltas and executes the tool', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-call-stream')),
      streamOf([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }]),
    ]);
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }];
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages,
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );
    const finished = events.find((event) => event.type === 'tool.finished');
    expect(finished).toMatchObject({
      type: 'tool.finished',
      output: 'wrote out.txt (5 bytes)',
    });
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hello');
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'complete',
    });
    expect(client.requests).toHaveLength(2);
    expect(messages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('denies a tool when approval is denied', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-call-stream')),
      streamOf([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
    ]);
    const events = await collect(
      runTurn({
        ctx: context({ permissionMode: 'ask' }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'deny',
      }),
    );
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    const finished = events.find((event) => event.type === 'tool.finished');
    expect(finished).toMatchObject({ output: 'denied by user', isError: true });
    await expect(readFile(join(root, 'out.txt'), 'utf8')).rejects.toThrow();
  });

  it('stops at the iteration cap', async () => {
    const payload = fixture('tool-call-stream');
    const client = new FakeClient([streamOf(payload), streamOf(payload)]);
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
        maxIterations: 2,
      }),
    );
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'error',
    });
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });
});

describe('createOpenAIChatAdapter', () => {
  it('runs two turns against a fake fetch and keeps history', async () => {
    const bodies: unknown[] = [];
    const responses = [
      streamOf(fixture('tool-call-stream')),
      streamOf([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }]),
      streamOf([{ choices: [{ delta: { content: 'again' }, finish_reason: 'stop' }] }]),
    ];
    const fetchFn = async (_input: string, init: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init.body)));
      const next = responses.shift();
      if (next === undefined) throw new Error('unexpected fetch');
      return new Response(next, { status: 200 });
    };
    const adapter = await createOpenAIChatAdapter(
      {
        id: 'p',
        kind: 'openai-compatible',
        label: 'Local',
        config: { baseUrl: 'http://127.0.0.1:1234/v1' },
        secret: null,
      },
      deps,
      { fetchFn },
    );

    const first = await collect(adapter.send('go', context()));
    expect(first.at(-1)).toMatchObject({ type: 'turn.finished', reason: 'complete' });
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hello');

    const second = await collect(adapter.send('again', context({ turnId: 'turn_2' })));
    expect(second.at(-1)).toMatchObject({ type: 'turn.finished', reason: 'complete' });
    expect(second).toContainEqual({ type: 'text.delta', turnId: 'turn_2', text: 'again' });

    const lastBody = bodies.at(-1) as { messages: { role: string }[] };
    expect(lastBody.messages[0]?.role).toBe('system');
    expect(lastBody.messages.some((message) => message.role === 'tool')).toBe(true);
    expect(lastBody.messages.at(-1)).toMatchObject({ role: 'user' });
    await adapter.dispose();
  });
});
