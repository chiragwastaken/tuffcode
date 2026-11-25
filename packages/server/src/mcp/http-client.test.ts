import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OAUTH_REQUIRED_MESSAGE,
  createHttpMcpClient,
  sseMessages,
  validateMcpUrl,
} from './http-client.js';

interface Recorded {
  method: string;
  rpc: string | undefined;
  session: string | undefined;
  protocol: string | undefined;
  auth: string | undefined;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? null : (JSON.parse(text) as Record<string, unknown>);
}

function startServer(
  mode: 'json' | 'sse',
  options: { unauthorized?: boolean } = {},
): Promise<{ url: string; server: Server; seen: Recorded[] }> {
  const seen: Recorded[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const message = await body(request);
      seen.push({
        method: request.method ?? '',
        rpc: typeof message?.method === 'string' ? message.method : undefined,
        session: request.headers['mcp-session-id'] as string | undefined,
        protocol: request.headers['mcp-protocol-version'] as string | undefined,
        auth: request.headers.authorization,
      });
      if (options.unauthorized === true) {
        response.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="x"' });
        response.end();
        return;
      }
      if (request.method === 'DELETE' || message === null || message.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      const result =
        message.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: {} }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'forecast', description: 'weather', inputSchema: { type: 'object' } }, { bad: true }] }
            : { content: [{ type: 'text', text: 'sunny' }, { type: 'image', data: 'x' }] };
      const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      const headers: Record<string, string> =
        message.method === 'initialize' ? { 'mcp-session-id': 'sess-1' } : {};
      if (mode === 'sse') {
        response.writeHead(200, { ...headers, 'content-type': 'text/event-stream' });
        response.end(`: keep-alive\n\nevent: message\ndata: ${payload}\n\n`);
      } else {
        response.writeHead(200, { ...headers, 'content-type': 'application/json' });
        response.end(payload);
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server, seen });
    });
  });
}

describe('http MCP client', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(['json', 'sse'] as const)('lists and calls tools over %s responses with a session', async (mode) => {
    const { url, server, seen } = await startServer(mode);
    servers.push(server);
    const client = createHttpMcpClient({ url, headers: { authorization: 'Bearer token-1' } });
    await client.initialize();
    expect(await client.listTools()).toEqual([
      { name: 'forecast', description: 'weather', inputSchema: { type: 'object' } },
    ]);
    expect(await client.callTool('forecast', { city: 'Pune' })).toBe('sunny{"type":"image","data":"x"}');
    await client.close();
    expect(seen.map((entry) => entry.rpc ?? entry.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
      'DELETE',
    ]);
    expect(seen[0]?.session).toBeUndefined();
    expect(seen[2]?.session).toBe('sess-1');
    expect(seen[2]?.protocol).toBe('2025-03-26');
    expect(seen.every((entry) => entry.auth === 'Bearer token-1')).toBe(true);
  });

  it('explains OAuth instead of failing with a bare 401', async () => {
    const { url, server } = await startServer('json', { unauthorized: true });
    servers.push(server);
    const client = createHttpMcpClient({ url });
    await expect(client.initialize()).rejects.toThrow(OAUTH_REQUIRED_MESSAGE);
  });

  it('times out a server that never answers', async () => {
    const server = createServer(() => undefined);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const client = createHttpMcpClient({ url: `http://127.0.0.1:${port}/mcp`, timeoutMs: 200 });
    await expect(client.initialize()).rejects.toThrow(/timed out after 200ms/);
    server.closeAllConnections();
  });

  it('accepts https and local http only', () => {
    expect(validateMcpUrl('https://mcp.example.com/mcp').hostname).toBe('mcp.example.com');
    expect(validateMcpUrl('http://localhost:3000/mcp').port).toBe('3000');
    expect(() => validateMcpUrl('http://example.com/mcp')).toThrow(/https/);
    expect(() => validateMcpUrl('ftp://example.com')).toThrow(/https/);
    expect(() => validateMcpUrl('not a url')).toThrow(/valid URL/);
  });

  it('reads JSON-RPC messages out of SSE events and skips noise', () => {
    expect(sseMessages('data: {"id":1}\n\n: ping\n\ndata: not json\n\ndata: {"id":\ndata: 2}\n\n')).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });
});
