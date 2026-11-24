import type { AdapterLogger } from '@tuffcode/contracts';

const MAX_EVENT_BYTES = 1024 * 1024;
const LF = String.fromCharCode(10);
const DONE = String.fromCharCode(91, 68, 79, 78, 69, 93);
const SEPARATORS = ['\r\n\r\n', '\n\n', '\r\r'] as const;

export interface SseOptions {
  signal?: AbortSignal;
  logger?: AdapterLogger;
}

type ParsedEvent =
  | { kind: 'data'; value: unknown }
  | { kind: 'done' }
  | { kind: 'invalid' }
  | { kind: 'empty' };

function findSeparator(buffer: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const separator of SEPARATORS) {
    const index = buffer.indexOf(separator);
    if (index === -1) continue;
    if (best === null || index < best.index) best = { index, length: separator.length };
  }
  return best;
}

function parseEvent(block: string): ParsedEvent {
  const data: string[] = [];
  for (const line of block.split(/\r\n|\n|\r/)) {
    if (line.length === 0 || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    data.push(value);
  }
  if (data.length === 0) return { kind: 'empty' };
  const payload = data.join(LF);
  const trimmed = payload.trim();
  if (trimmed === DONE) return { kind: 'done' };
  try {
    return { kind: 'data', value: JSON.parse(trimmed) };
  } catch {
    return { kind: 'invalid' };
  }
}

export async function* streamSse(
  body: ReadableStream<Uint8Array>,
  options: SseOptions = {},
): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const signal = options.signal;
  const logger = options.logger;
  let buffer = '';
  let overflow = false;
  let finished = false;

  const drain = function* (): Generator<unknown> {
    while (!finished) {
      const separator = findSeparator(buffer);
      if (separator === null) return;
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator.length);
      const parsed = parseEvent(block);
      if (parsed.kind === 'done') {
        finished = true;
        return;
      }
      if (parsed.kind === 'invalid') {
        logger?.debug('openai sse payload skipped', { reason: 'invalid json' });
      } else if (parsed.kind === 'data') {
        yield parsed.value;
      }
    }
  };

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (!finished) {
      if (signal?.aborted) return;
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      if (overflow) {
        const separator = findSeparator(buffer);
        if (separator === null) {
          buffer = '';
        } else {
          buffer = buffer.slice(separator.index + separator.length);
          overflow = false;
        }
      }

      if (buffer.length > MAX_EVENT_BYTES) {
        const separator = findSeparator(buffer);
        buffer = separator === null ? '' : buffer.slice(separator.index + separator.length);
        overflow = separator === null;
        logger?.warn('openai sse event dropped', { reason: 'event exceeded 1 MiB' });
      }

      yield* drain();
      if (finished) return;
    }

    buffer += decoder.decode();
    if (!overflow && buffer.length > 0) {
      const parsed = parseEvent(buffer);
      if (parsed.kind === 'invalid') {
        logger?.debug('openai sse payload skipped', { reason: 'invalid json' });
      } else if (parsed.kind === 'data') {
        yield parsed.value;
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => undefined);
  }
}
