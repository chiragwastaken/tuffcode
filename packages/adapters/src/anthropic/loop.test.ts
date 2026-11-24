import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterDeps, AdapterEvent, AdapterLogger, TurnContext } from '@tuffcode/contracts';
import type { AnthropicMessage, AnthropicRequestBody, MessagesStreamer } from './client.js';
import { mapStopReason, runTurn } from './loop.js';
import { createToolSessionState } from '../openai/tools.js';

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
    brainSlice: '',
    attachments: [],
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

/** Splits the SSE text every `splitEvery` bytes when set, to exercise buffering. */
function streamOf(events: FixtureEvent[], splitEvery = 0): ReadableStream<Uint8Array> {
  const text = events
    .map((entry) => 'event: ' + entry.event + LF + 'data: ' + JSON.stringify(entry.data) + LF + LF)
    .join('');
  const bytes = encoder.encode(text);
  const chunks: Uint8Array[] = [];
  if (splitEvery > 0) {
    for (let offset = 0; offset < bytes.length; offset += splitEvery) {
      chunks.push(bytes.slice(offset, offset + splitEvery));
    }
  } else {
    chunks.push(bytes);
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tuffcode-anthropic-loop-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

class FakeClient implements MessagesStreamer {
  readonly requests: AnthropicRequestBody[] = [];
  private index = 0;

  constructor(private readonly streams: ReadableStream<Uint8Array>[]) {}

  async stream(request: AnthropicRequestBody): Promise<ReadableStream<Uint8Array>> {
    this.requests.push({ ...request, messages: structuredClone(request.messages) });
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
  it('assembles text across arbitrary SSE chunk splits and reports usage', async () => {
    const client = new FakeClient([streamOf(fixture('text-stream'), 7)]);
    const messages: AnthropicMessage[] = [{ role: 'user', content: 'go' }];
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages,
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        maxTokens: 256,
        requestApproval: async () => 'allow',
      }),
    );

    const deltas = events.filter((event) => event.type === 'text.delta');
    expect(deltas).toEqual([
      { type: 'text.delta', turnId: 'turn_1', text: 'Hel' },
      { type: 'text.delta', turnId: 'turn_1', text: 'lo' },
    ]);
    expect(events).toContainEqual({
      type: 'usage',
      turnId: 'turn_1',
      inputTokens: 12,
      outputTokens: 5,
    });
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'complete',
    });
    expect(messages).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Hello' },
    ]);
    expect(client.requests[0]?.system).toBe('You are Tuffcode.');
    expect(client.requests[0]?.max_tokens).toBe(256);
  });

  it('assembles a split tool_use block, runs the tool, and sends the result back', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-use-stream'), 11),
      streamOf(fixture('text-stream')),
    ]);
    const messages: AnthropicMessage[] = [{ role: 'user', content: 'go' }];
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages,
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        maxTokens: 256,
        requestApproval: async () => 'allow',
      }),
    );

    const started = events.find((event) => event.type === 'tool.started');
    expect(started).toMatchObject({
      type: 'tool.started',
      turnId: 'turn_1',
      toolCallId: 'toolu_1',
      name: 'write',
      input: { path: 'out.txt', content: 'hello' },
    });
    expect(events.find((event) => event.type === 'tool.finished')).toMatchObject({
      type: 'tool.finished',
      toolCallId: 'toolu_1',
      output: 'wrote out.txt (5 bytes)',
      isError: false,
    });
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hello');
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'complete',
    });

    expect(client.requests).toHaveLength(2);
    const second = client.requests[1]?.messages ?? [];
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Writing.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'write',
          input: { path: 'out.txt', content: 'hello' },
        },
      ],
    });
    expect(second[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'wrote out.txt (5 bytes)',
        },
      ],
    });
  });

  it('denies a tool when approval is denied', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-use-stream')),
      streamOf(fixture('text-stream')),
    ]);
    const events = await collect(
      runTurn({
        ctx: context({ permissionMode: 'ask' }),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        maxTokens: 256,
        requestApproval: async () => 'deny',
      }),
    );

    const approval = events.find((event) => event.type === 'approval.requested');
    expect(approval).toMatchObject({
      type: 'approval.requested',
      turnId: 'turn_1',
      toolCallId: 'toolu_1',
      name: 'write',
      input: { path: 'out.txt', content: 'hello' },
    });
    expect(events.find((event) => event.type === 'tool.finished')).toMatchObject({
      output: 'denied by user',
      isError: true,
    });
    await expect(readFile(join(root, 'out.txt'), 'utf8')).rejects.toThrow();
  });

  it('maps a refusal stop_reason to an error turn', async () => {
    const client = new FakeClient([streamOf(fixture('refusal-stream'))]);
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        maxTokens: 256,
        requestApproval: async () => 'allow',
      }),
    );

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'error',
    });
  });

  it('stops at the iteration cap', async () => {
    const client = new FakeClient([
      streamOf(fixture('tool-use-stream')),
      streamOf(fixture('tool-use-stream')),
    ]);
    const events = await collect(
      runTurn({
        ctx: context(),
        client,
        messages: [{ role: 'user', content: 'go' }],
        state: createToolSessionState(),
        deps,
        signal: new AbortController().signal,
        maxTokens: 256,
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

describe('mapStopReason', () => {
  it('completes on normal stops and errors only on refusal', () => {
    expect(mapStopReason('end_turn')).toBe('complete');
    expect(mapStopReason('tool_use')).toBe('complete');
    expect(mapStopReason('max_tokens')).toBe('complete');
    expect(mapStopReason('stop_sequence')).toBe('complete');
    expect(mapStopReason(null)).toBe('complete');
    expect(mapStopReason('refusal')).toBe('error');
  });
});
