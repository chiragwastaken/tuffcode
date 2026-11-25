import { spawn } from 'node:child_process';
import type { McpServer, McpTool } from '@tuffcode/contracts';
import { z } from 'zod';

/**
 * Newline-delimited JSON-RPC 2.0 client for a stdio MCP server, D47.
 *
 * One child per client. Every request gets its own timeout; a timeout, a spawn
 * failure or a close rejects every pending request and kills the child, because a
 * half-dead stdio server cannot be trusted for later calls.
 */
export const DEFAULT_MCP_TIMEOUT_MS = 10_000;
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_CLIENT_VERSION = '0.1.3';
export const MCP_RESULT_LIMIT = 64 * 1024;

const STDERR_LIMIT = 1_000;
const STDERR_SUFFIX_LIMIT = 200;
/** No valid response line can exceed this; a longer one is dropped, not buffered. */
const MAX_LINE_BUFFER = MCP_RESULT_LIMIT * 2;
const LINE_TOO_LONG = `MCP server sent a response line longer than ${MAX_LINE_BUFFER} bytes`;

const ResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const ToolsResultSchema = z.object({ tools: z.array(z.unknown()).optional() });

const ToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});

const InputSchema = z.record(z.string(), z.unknown());

const ContentResultSchema = z.object({ content: z.array(z.unknown()).optional() });

const TextContentSchema = z.object({ type: z.literal('text'), text: z.string() });

export interface McpChild {
  stdin: {
    write(chunk: string): boolean;
    on(event: 'error', listener: (error: Error) => void): unknown;
  } | null;
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
  /** Present on a real child; a fake may omit it, which forces a plain kill. */
  pid?: number;
}

export interface McpSpawnOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  windowsHide: boolean;
  stdio: ['pipe', 'pipe', 'pipe'];
}

/** Test seam: production uses `spawn`; tests pass a fake child. */
export type McpSpawnFn = (
  command: string,
  args: readonly string[],
  options: McpSpawnOptions,
) => McpChild;

export interface McpClientOptions {
  timeoutMs?: number;
  spawnFn?: McpSpawnFn;
  /** Defaults to the host platform; tests pin it to check the Windows tree kill. */
  platform?: NodeJS.Platform;
}

export interface McpClient {
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

interface PendingRequest {
  method: string;
  timer: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: McpSpawnOptions,
): McpChild {
  const child = spawn(command, [...args], options);
  // A write that races the child exit surfaces as an EPIPE on stdin; without a
  // listener that becomes an uncaught exception that takes the server down.
  child.stdin?.on('error', () => undefined);
  return child;
}

function capResult(text: string): string {
  return text.length > MCP_RESULT_LIMIT ? text.slice(0, MCP_RESULT_LIMIT) : text;
}

/** Tools from a `tools/list` result; malformed entries are skipped. Shared by both transports. */
export function parseToolsResult(raw: unknown): McpTool[] {
  const result = ToolsResultSchema.safeParse(raw);
  const entries = result.success ? (result.data.tools ?? []) : [];
  const tools: McpTool[] = [];
  for (const entry of entries) {
    const parsed = ToolSchema.safeParse(entry);
    if (!parsed.success) continue;
    const inputSchema = InputSchema.safeParse(parsed.data.inputSchema);
    tools.push({
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      inputSchema: inputSchema.success ? inputSchema.data : {},
    });
  }
  return tools;
}

/** The text of a `tools/call` result, non-text parts as JSON, capped. */
export function parseCallResult(raw: unknown): string {
  const result = ContentResultSchema.safeParse(raw);
  const content = result.success ? (result.data.content ?? []) : [];
  const parts: string[] = [];
  for (const entry of content) {
    const text = TextContentSchema.safeParse(entry);
    parts.push(text.success ? text.data.text : JSON.stringify(entry));
  }
  return capResult(parts.join(''));
}

/**
 * Kills the whole child tree on Windows, where `kill()` leaves grandchildren such as
 * a wrapper script's real server running; every other platform gets a plain kill.
 * Neither path may throw: shutdown runs from exit handlers and from `close()`.
 */
function killChild(child: McpChild, platform: NodeJS.Platform): void {
  const pid = child.pid;
  if (platform === 'win32' && typeof pid === 'number') {
    try {
      const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
      });
      taskkill.on('error', () => undefined);
      taskkill.unref();
      return;
    } catch {
      // taskkill missing or unrunnable: fall through to the direct kill.
    }
  }
  try {
    child.kill();
  } catch {
    // A child that already exited throws here; close must never surface it.
  }
}

export function createMcpClient(server: McpServer, options: McpClientOptions = {}): McpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  const spawnFn = options.spawnFn ?? defaultSpawn;
  const platform = options.platform ?? process.platform;
  const child = spawnFn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    ...(server.cwd === null ? {} : { cwd: server.cwd }),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let buffer = '';
  let discarding = false;
  let stderrText = '';
  let closed = false;
  let initPromise: Promise<void> | null = null;

  function stderrSuffix(): string {
    const trimmed = stderrText.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0) return '';
    return ` (stderr: ${trimmed.slice(-STDERR_SUFFIX_LIMIT)})`;
  }

  function rejectPending(message: string): void {
    const error = new Error(`${message}${stderrSuffix()}`);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function shutdown(message: string): void {
    if (closed) return;
    closed = true;
    rejectPending(message);
    killChild(child, platform);
  }

  function write(value: Record<string, unknown>): void {
    if (closed) throw new Error(`MCP client is closed${stderrSuffix()}`);
    const stdin = child.stdin;
    if (stdin === null) throw new Error('MCP server stdin is not available');
    stdin.write(`${JSON.stringify(value)}\n`);
  }

  function handleLine(line: string): void {
    if (line.length > MAX_LINE_BUFFER) {
      rejectPending(LINE_TOO_LONG);
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = ResponseSchema.safeParse(decoded);
    if (!parsed.success) return;
    const id = typeof parsed.data.id === 'number' ? parsed.data.id : Number(parsed.data.id);
    const request = pending.get(id);
    if (request === undefined) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (parsed.data.error !== undefined) {
      const text = parsed.data.error.message ?? 'request failed';
      request.reject(new Error(`MCP ${request.method} failed: ${text}${stderrSuffix()}`));
      return;
    }
    request.resolve(parsed.data.result);
  }

  child.stdout?.on('data', (chunk) => {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (discarding) {
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      discarding = false;
      text = text.slice(newline + 1);
    }
    buffer += text;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) handleLine(line);
      index = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_LINE_BUFFER) {
      // A single line cannot be parsed for its id once it is this large, so every
      // pending request is failed and the rest of the line is dropped instead of
      // buffered. The client stays open: the next complete line works normally.
      discarding = true;
      buffer = '';
      rejectPending(LINE_TOO_LONG);
    }
  });

  child.stderr?.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stderrText = `${stderrText}${text}`.slice(-STDERR_LIMIT);
  });

  child.on('error', (error) => {
    const text = error instanceof Error ? error.message : 'spawn failed';
    shutdown(`MCP server failed: ${text}`);
  });

  child.on('exit', (code) => {
    const detail = typeof code === 'number' ? ` with code ${code}` : '';
    shutdown(`MCP server exited${detail}`);
  });

  function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (closed) return Promise.reject(new Error(`MCP client is closed${stderrSuffix()}`));
    const id = nextId;
    nextId += 1;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      shutdown(`MCP request ${method} timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, { method, timer, resolve, reject });
    try {
      write({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error('MCP write failed'));
    }
    return promise;
  }

  return {
    initialize: () => {
      if (initPromise !== null) return initPromise;
      initPromise = (async () => {
        await request('initialize', {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'tuffcode', version: MCP_CLIENT_VERSION },
        });
        write({ jsonrpc: '2.0', method: 'notifications/initialized' });
      })();
      return initPromise;
    },

    listTools: async () => parseToolsResult(await request('tools/list', {})),

    callTool: async (name, args) =>
      parseCallResult(await request('tools/call', { name, arguments: args })),

    close: async () => {
      shutdown('MCP client closed');
    },
  };
}
