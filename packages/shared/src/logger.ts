import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  dir: string;
  channel: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => Date;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(channel: string): Logger;
  flush(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const MIN_MAX_BYTES = 256;
const LINE_OVERHEAD = 256;
const REDACTED = '[redacted]';

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/ghp_[A-Za-z0-9]{8,}/g, REDACTED],
  [/Bearer\s+\S+/gi, `Bearer ${REDACTED}`],
  [/(token=)[^&\s]+/gi, `$1${REDACTED}`],
  [/(api[_-]?key['"]?\s*[:=]\s*)\S+/gi, `$1${REDACTED}`],
];

function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (depth >= 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactValue(item, depth + 1);
  }
  return out;
}

function clampToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return `${out} [truncated]`;
}

interface ChannelState {
  ready: boolean;
  degraded: boolean;
  closed: boolean;
  size: number;
}

interface LogFile {
  index: number;
  path: string;
  size: number;
}

function createLoggerWithState(options: LoggerOptions, state: ChannelState): Logger {
  const dir = options.dir;
  const channel = options.channel;
  const maxBytes = Math.max(MIN_MAX_BYTES, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
  const totalCap = maxBytes * maxFiles;
  const now = options.now ?? (() => new Date());
  const messageBudget = Math.max(64, maxBytes - LINE_OVERHEAD);

  const filePath = (index: number): string =>
    join(dir, index === 0 ? `${channel}.log` : `${channel}.${index}.log`);

  function fileIndex(name: string): number | null {
    if (name === `${channel}.log`) return 0;
    const prefix = `${channel}.`;
    if (!name.startsWith(prefix) || !name.endsWith('.log')) return null;
    const middle = name.slice(prefix.length, -'.log'.length);
    if (!/^\d+$/.test(middle)) return null;
    const index = Number(middle);
    return Number.isSafeInteger(index) && index > 0 ? index : null;
  }

  function scanFiles(): LogFile[] {
    const files: LogFile[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const index = fileIndex(entry.name);
      if (index === null) continue;
      const path = join(dir, entry.name);
      files.push({ index, path, size: statSync(path).size });
    }
    return files;
  }

  function enforceCap(files: LogFile[]): LogFile[] {
    files.sort((a, b) => b.index - a.index);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const kept: LogFile[] = [];
    for (const file of files) {
      if (file.index >= maxFiles) {
        rmSync(file.path, { force: true });
        total -= file.size;
      } else {
        kept.push(file);
      }
    }
    while (total > totalCap && kept.length > 0) {
      const victim = kept.shift();
      if (victim === undefined) break;
      rmSync(victim.path, { force: true });
      total -= victim.size;
    }
    return kept;
  }

  function warnOnce(error: unknown): void {
    if (state.degraded) return;
    state.degraded = true;
    const detail = error instanceof Error ? error.message : String(error);
    try {
      process.stderr.write(`[tuffcode:logger] ${channel} logging disabled: ${detail}\n`);
    } catch {
      // stderr is gone too; nothing left to report to.
    }
  }

  function init(): void {
    mkdirSync(dir, { recursive: true });
    enforceCap(scanFiles());
    state.size = existsSync(filePath(0)) ? statSync(filePath(0)).size : 0;
    state.ready = true;
  }

  function rotate(): void {
    if (maxFiles === 1) {
      rmSync(filePath(0), { force: true });
      state.size = 0;
      return;
    }
    rmSync(filePath(maxFiles - 1), { force: true });
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      if (existsSync(filePath(index))) renameSync(filePath(index), filePath(index + 1));
    }
    if (existsSync(filePath(0))) renameSync(filePath(0), filePath(1));
    state.size = 0;
    // Old files may predate the current cap; trim until the channel fits.
    enforceCap(scanFiles());
  }

  function formatLine(
    level: LogLevel,
    message: string,
    initialFields: Record<string, unknown> | undefined,
  ): string {
    const ts = now().toISOString();
    const safeMessage = redact(message);
    let fields = initialFields;
    let budget = messageBudget;
    for (;;) {
      const msg = clampToBytes(safeMessage, budget);
      let line: string;
      try {
        const entry =
          fields === undefined
            ? { ts, level, channel, msg }
            : { ts, level, channel, msg, fields: redactValue(fields) };
        line = JSON.stringify(entry);
      } catch {
        line = JSON.stringify({ ts, level, channel, msg: `${msg} [fields dropped]` });
      }
      if (Buffer.byteLength(line, 'utf8') <= maxBytes - 1 || budget <= 32) return line;
      budget = Math.max(32, Math.floor(budget / 2));
      fields = undefined;
    }
  }

  function write(
    level: LogLevel,
    message: string,
    fields: Record<string, unknown> | undefined,
  ): void {
    if (state.closed || state.degraded) return;
    const line = `${formatLine(level, message, fields)}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    try {
      if (!state.ready) init();
      if (state.size > 0 && state.size + bytes > maxBytes) rotate();
      appendFileSync(filePath(0), line, 'utf8');
      state.size += bytes;
    } catch (error) {
      warnOnce(error);
    }
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (childChannel) =>
      createLoggerWithState(
        { ...options, channel: childChannel },
        {
          ready: false,
          degraded: false,
          closed: false,
          size: 0,
        },
      ),
    flush: () => Promise.resolve(),
    close: () => {
      state.closed = true;
      return Promise.resolve();
    },
  };
}

/**
 * JSON-lines logger with size rotation and secret redaction. Writes are synchronous,
 * so `flush` only exists to satisfy async shutdown paths. IO failures never throw: the
 * first one writes a single stderr warning and the logger stops writing.
 */
export function createLogger(options: LoggerOptions): Logger {
  return createLoggerWithState(options, {
    ready: false,
    degraded: false,
    closed: false,
    size: 0,
  });
}
