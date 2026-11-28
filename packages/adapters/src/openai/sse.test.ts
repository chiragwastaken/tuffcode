import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SSE_IDLE_TIMEOUT_MS, streamSse } from './sse.js';

const encoder = new TextEncoder();

afterEach(() => {
  vi.useRealTimers();
});

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal } = {},
): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of streamSse(stream, options)) values.push(value);
  return values;
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const DONE = 'data: ' + String.fromCharCode(91, 68, 79, 78, 69, 93) + CR + LF + CR + LF;

describe('streamSse', () => {
  it('survives CRLF and multibyte chunk boundaries', async () => {
    const text =
      'data: {"text":"h' +
      String.fromCharCode(233) +
      'llo"}' +
      CR +
      LF +
      CR +
      LF +
      'data: {"n":2}' +
      LF +
      LF +
      DONE;
    const bytes = encoder.encode(text);
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
    const values = await collect(byteStream(chunks));
    expect(values).toEqual([{ text: 'h' + String.fromCharCode(233) + 'llo' }, { n: 2 }]);
  });

  it('joins data lines and ignores comments and fields', async () => {
    const text =
      ': comment' +
      LF +
      'event: message' +
      LF +
      'data: {"a":' +
      LF +
      'data: 1}' +
      LF +
      LF +
      DONE;
    const values = await collect(byteStream([encoder.encode(text)]));
    expect(values).toEqual([{ a: 1 }]);
  });

  it('skips malformed JSON and stops at the done marker', async () => {
    const text =
      'data: {oops}' +
      LF +
      LF +
      'data: {"ok":true}' +
      LF +
      LF +
      DONE +
      'data: {"late":1}' +
      LF +
      LF;
    const values = await collect(byteStream([encoder.encode(text)]));
    expect(values).toEqual([{ ok: true }]);
  });

  it('honors an abort signal', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(inner) {
        inner.enqueue(encoder.encode('data: {"first":1}' + LF + LF));
      },
      cancel() {
        cancelled = true;
      },
    });
    const iterator = streamSse(stream, { signal: controller.signal })[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({ first: 1 });
    controller.abort();
    const second = await iterator.next();
    expect(second.done).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('aborts a silent stream after the idle budget', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
      },
    });
    const iterator = streamSse(stream, { idleTimeoutMs: 1000 })[Symbol.asyncIterator]();
    const rejection = expect(iterator.next()).rejects.toMatchObject({
      name: 'SseIdleTimeoutError',
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(cancelled).toBe(true);
  });

  it('resets the idle budget whenever a chunk arrives', async () => {
    vi.useFakeTimers();
    let inner: { enqueue: (chunk: Uint8Array) => void };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        inner = controller;
      },
      cancel() {},
    });
    const iterator = streamSse(stream, { idleTimeoutMs: 1000 })[Symbol.asyncIterator]();

    inner.enqueue(encoder.encode('data: {"n":1}' + LF + LF));
    expect((await iterator.next()).value).toEqual({ n: 1 });

    await vi.advanceTimersByTimeAsync(900);
    inner.enqueue(encoder.encode('data: {"n":2}' + LF + LF));
    expect((await iterator.next()).value).toEqual({ n: 2 });

    const rejection = expect(iterator.next()).rejects.toMatchObject({
      name: 'SseIdleTimeoutError',
    });
    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it('defaults the idle budget to 120 seconds', () => {
    expect(DEFAULT_SSE_IDLE_TIMEOUT_MS).toBe(120_000);
  });
});
