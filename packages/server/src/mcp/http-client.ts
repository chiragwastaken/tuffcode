import { z } from 'zod';
import {
  DEFAULT_MCP_TIMEOUT_MS,
  MCP_CLIENT_VERSION,
  parseCallResult,
  parseToolsResult,
  type McpClient,
} from './client.js';

/**
 * Streamable HTTP MCP client (protocol 2025-03-26 and later): every request is a
 * POST, the answer is either a JSON body or an SSE stream carrying the response, and
 * the server may pin a session with `Mcp-Session-Id`. No new dependency: `fetch` and a
 * small SSE reader cover it. Bearer tokens arrive through `headers` and are never
 * logged or echoed in errors.
 */
export const HTTP_MCP_PROTOCOL_VERSION = '2025-06-18';
export const HTTP_MCP_BODY_LIMIT = 4 * 1024 * 1024;

export const OAUTH_REQUIRED_MESSAGE =
  'This connector needs OAuth sign-in. Choose Browser OAuth in the connector settings and sign in again.';

/**
 * Thrown when the connector cannot authenticate without the user signing in again. The
 * service turns it into `needsAuth: true` on `mcp.test` instead of a raw HTTP error.
 */
export class McpAuthRequiredError extends Error {
  readonly code = 'mcp_auth_required';

  constructor(message: string = OAUTH_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'McpAuthRequiredError';
  }
}

export type McpFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Supplies credentials per request. `headers` runs before every call, so an expired
 * OAuth token is refreshed before the request rather than after a 401. `refresh` runs
 * after a 401; true means new credentials exist and the call may be retried once.
 */
export interface HttpMcpAuthProvider {
  headers(): Promise<Record<string, string>>;
  refresh?(): Promise<boolean>;
}

export interface HttpMcpClientOptions {
  url: string;
  headers?: Record<string, string>;
  auth?: HttpMcpAuthProvider;
  timeoutMs?: number;
  fetchFn?: McpFetch;
}

const ResponseSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional(), code: z.number().optional() }).optional(),
});

const InitializeResultSchema = z.object({ protocolVersion: z.string().optional() });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** https anywhere, plain http only for a local development server. */
export function validateMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('the MCP server URL is not a valid URL');
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url;
  throw new Error('the MCP server URL must use https (plain http is allowed only for localhost)');
}

/** Reads a body up to the cap; a larger body is an error rather than a truncated parse. */
async function readCapped(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > HTTP_MCP_BODY_LIMIT) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`MCP response exceeded ${HTTP_MCP_BODY_LIMIT} bytes`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/** The JSON-RPC messages inside an SSE body: every `data:` block, joined per event. */
export function sseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const block of body.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data.trim().length === 0) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // A keep-alive or a non-JSON event is not a response; skip it.
    }
  }
  return messages;
}

function findResponse(messages: unknown[], id: number): z.infer<typeof ResponseSchema> | null {
  for (const message of messages.flat()) {
    const parsed = ResponseSchema.safeParse(message);
    if (parsed.success && parsed.data.id === id) return parsed.data;
  }
  return null;
}

export function createHttpMcpClient(options: HttpMcpClientOptions): McpClient {
  const url = validateMcpUrl(options.url).toString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  const fetchFn: McpFetch = options.fetchFn ?? ((input, init) => fetch(input, init));
  const baseHeaders = options.headers ?? {};
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  let nextId = 1;
  let initPromise: Promise<void> | null = null;

  async function headers(): Promise<Record<string, string>> {
    const supplied = options.auth === undefined ? {} : await options.auth.headers();
    return {
      ...baseHeaders,
      ...supplied,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
      ...(protocolVersion === null ? {} : { 'mcp-protocol-version': protocolVersion }),
    };
  }

  async function post(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const send = (headerSet: Record<string, string>): Promise<Response> =>
      fetchFn(url, {
        method: 'POST',
        headers: headerSet,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    try {
      let response = await send(await headers());
      if (response.status === 401 || response.status === 403) {
        const challenge = response.headers.get('www-authenticate') ?? '';
        await response.body?.cancel().catch(() => undefined);
        const refreshed = options.auth?.refresh === undefined ? false : await options.auth.refresh();
        if (refreshed) response = await send(await headers());
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel().catch(() => undefined);
          throw refusal(challenge, response.status, options.auth);
        }
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(`the MCP server answered with status ${response.status}`);
      }
      const session = response.headers.get('mcp-session-id');
      if (session !== null && session.length > 0) sessionId = session;
      return response;
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`MCP request timed out after ${timeoutMs}ms`, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    const response = await post({ jsonrpc: '2.0', id, method, params });
    const type = response.headers.get('content-type') ?? '';
    const body = await readCapped(response);
    const messages = type.includes('text/event-stream') ? sseMessages(body) : parseJsonBody(body);
    const answer = findResponse(messages, id);
    if (answer === null) throw new Error(`the MCP server sent no response to ${method}`);
    if (answer.error !== undefined) {
      throw new Error(answer.error.message ?? `MCP ${method} failed`);
    }
    return answer.result;
  }

  return {
    initialize: () => {
      if (initPromise !== null) return initPromise;
      initPromise = (async () => {
        const result = InitializeResultSchema.safeParse(
          await request('initialize', {
            protocolVersion: HTTP_MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'tuffcode', version: MCP_CLIENT_VERSION },
          }),
        );
        protocolVersion = (result.success ? result.data.protocolVersion : undefined) ?? HTTP_MCP_PROTOCOL_VERSION;
        const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        await notified.body?.cancel().catch(() => undefined);
      })();
      return initPromise;
    },
    listTools: async () => parseToolsResult(await request('tools/list', {})),
    callTool: async (name, args) =>
      parseCallResult(await request('tools/call', { name, arguments: args })),
    close: async () => {
      if (sessionId === null) return;
      const id = sessionId;
      sessionId = null;
      try {
        const supplied = options.auth === undefined ? {} : await options.auth.headers();
        await fetchFn(url, {
          method: 'DELETE',
          headers: { ...baseHeaders, ...supplied, 'mcp-session-id': id },
        });
      } catch {
        // Ending the session is a courtesy; the server expires it on its own.
      }
    },
  };
}

function refusal(
  challenge: string,
  status: number,
  auth: HttpMcpAuthProvider | undefined,
): Error {
  if (auth?.refresh !== undefined) {
    return new McpAuthRequiredError('The connector needs you to sign in again.');
  }
  if (/bearer|oauth|resource_metadata/i.test(challenge)) return new McpAuthRequiredError();
  return new Error(`the MCP server refused the credentials (status ${status})`);
}

function parseJsonBody(body: string): unknown[] {
  if (body.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error('the MCP server sent a response that is not JSON');
  }
}
