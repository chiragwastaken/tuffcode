import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterDeps, AdapterEvent, AdapterLogger, TurnContext } from '@tuffcode/contracts';
import type { ChatMessage, ChatRequestBody, ChatStreamer } from './client.js';
import { createOpenAIChatAdapter } from './index.js';
import { compactHistory, runTurn } from './loop.js';
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

  it('redacts a secret in the approval event and executes the raw arguments', async () => {
    const calls: { name: string; args: Record<string, unknown>; cwd: string }[] = [];
    const withRunner: AdapterDeps = {
      ...deps,
      extraTool: async (name, args, ctx) => {
        calls.push({ name, args, cwd: ctx.cwd });
        return 'created';
      },
    };
    const client = new FakeClient([
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_cfg',
                    function: {
                      name: 'config',
                      arguments:
                        '{"action":"provider.add","label":"Remote","apiKey":"sk-approval"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
      streamOf([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }]),
    ]);
    const events = await collect(
      runTurn({
        ctx: context({ permissionMode: 'ask' }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps: withRunner,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );

    expect(events.find((event) => event.type === 'approval.requested')).toMatchObject({
      type: 'approval.requested',
      toolCallId: 'call_cfg',
      name: 'config',
      input: { action: 'provider.add', label: 'Remote', apiKey: '[redacted]' },
    });
    expect(events.find((event) => event.type === 'tool.started')).toMatchObject({
      input: { action: 'provider.add', label: 'Remote', apiKey: '[redacted]' },
    });
    expect(JSON.stringify(events)).not.toContain('sk-approval');
    expect(calls).toEqual([
      {
        name: 'config',
        args: { action: 'provider.add', label: 'Remote', apiKey: 'sk-approval' },
        cwd: root,
      },
    ]);
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

  it('offers only the allowlisted tools and rejects a disabled call', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-call-stream')),
      streamOf([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
    ]);
    const events = await collect(
      runTurn({
        ctx: context({ toolAllowlist: ['read'] }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );

    expect(client.requests[0]?.toolAllowlist).toEqual(['read']);
    const finished = events.find((event) => event.type === 'tool.finished');
    expect(finished).toMatchObject({
      type: 'tool.finished',
      output: 'tool "write" is disabled in settings',
      isError: true,
    });
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    await expect(readFile(join(root, 'out.txt'), 'utf8')).rejects.toThrow();
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'complete',
    });
  });

  it('honours the per-turn iteration cap over the adapter cap', async () => {
    const payload = fixture('tool-call-stream');
    const client = new FakeClient([streamOf(payload), streamOf(payload)]);
    const events = await collect(
      runTurn({
        ctx: context({ maxToolIterations: 1, toolAllowlist: ['write'] }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
        maxIterations: 5,
      }),
    );

    expect(client.requests).toHaveLength(1);
    expect(
      events.some(
        (event) => event.type === 'error' && event.message.includes('stopped after 1 tool'),
      ),
    ).toBe(true);
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'error',
    });
  });

  it('offers the extra tools and runs a memory search through the runner', async () => {
    const calls: { name: string; args: Record<string, unknown>; cwd: string }[] = [];
    const withRunner: AdapterDeps = {
      ...deps,
      extraTool: async (name, args, ctx) => {
        calls.push({ name, args, cwd: ctx.cwd });
        return 'two entries: build uses pnpm';
      },
    };
    const client = new FakeClient([
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_mem',
                    function: {
                      name: 'memory',
                      arguments: '{"action":"search","query":"build"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
      streamOf([{ choices: [{ delta: { content: 'found' }, finish_reason: 'stop' }] }]),
    ]);
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }];
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages,
        state: createToolSessionState(),
        deps: withRunner,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );

    expect(client.requests[0]?.extraTools).toBe(true);
    expect(events.find((event) => event.type === 'tool.started')).toMatchObject({
      type: 'tool.started',
      toolCallId: 'call_mem',
      name: 'memory',
      input: { action: 'search', query: 'build' },
    });
    expect(events.find((event) => event.type === 'tool.finished')).toMatchObject({
      type: 'tool.finished',
      toolCallId: 'call_mem',
      output: 'two entries: build uses pnpm',
      isError: false,
    });
    expect(calls).toEqual([
      { name: 'memory', args: { action: 'search', query: 'build' }, cwd: root },
    ]);
    expect(messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call_mem',
      content: 'two entries: build uses pnpm',
    });
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
  });

  it('does not offer the extra tools without a runner', async () => {
    const client = new FakeClient([
      streamOf([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
    ]);
    await collect(
      runTurn({
        ctx: context(),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );

    expect(client.requests[0]?.extraTools).toBeUndefined();
  });
});

describe('compactHistory', () => {
  it('folds all but the last two messages into one system message', async () => {
    const client = new FakeClient([
      streamOf([{ choices: [{ delta: { content: 'summary text' }, finish_reason: 'stop' }] }]),
    ]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ];

    const result = await compactHistory({
      client,
      messages,
      model: 'test-model',
      deps,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ removed: 2 });
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('summary text');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ]);
    expect(client.requests[0]?.toolAllowlist).toEqual([]);
    expect(client.requests[0]?.messages[0]?.role).toBe('system');
  });

  it('keeps a leading tool result with the assistant call it answers', async () => {
    const client = new FakeClient([
      streamOf([{ choices: [{ delta: { content: 'summary' }, finish_reason: 'stop' }] }]),
    ]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'one' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
      { role: 'assistant', content: 'done' },
    ];

    const result = await compactHistory({
      client,
      messages,
      model: 'test-model',
      deps,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ removed: 1 });
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('keeps history and reports zero when the summary request fails', async () => {
    const client = new FakeClient([]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ];

    const result = await compactHistory({
      client,
      messages,
      model: 'test-model',
      deps,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ removed: 0 });
    expect(messages).toHaveLength(4);
  });
});

describe('max tokens', () => {
  it('sends the turn output cap on the request', async () => {
    const client = new FakeClient([
      streamOf([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
    ]);
    await collect(
      runTurn({
        ctx: context({ maxOutputTokens: 777 }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        requestApproval: async () => 'allow',
      }),
    );

    expect(client.requests[0]?.maxTokens).toBe(777);
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
