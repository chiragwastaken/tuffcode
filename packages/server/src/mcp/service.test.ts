import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer, McpTool } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../events.js';
import type { Secrets } from '../secrets/bridge.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { MCP_PROTOCOL_VERSION, type McpChild } from './client.js';
import { MCP_TOOL_CACHE_TTL_MS, createMcpService, type McpService } from './service.js';

interface FakeChild {
  writes: Record<string, unknown>[];
  stdout: EventEmitter;
  stderr: EventEmitter;
  events: EventEmitter;
  killCalls: number;
}

function fakeChild(
  onMessage: (message: Record<string, unknown>, fake: FakeChild) => void,
): McpChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const events = new EventEmitter();
  const fake: FakeChild = { writes: [], stdout, stderr, events, killCalls: 0 };
  return {
    stdin: {
      write: (chunk: string) => {
        const message = JSON.parse(chunk) as Record<string, unknown>;
        fake.writes.push(message);
        onMessage(message, fake);
        return true;
      },
      on: () => undefined,
    },
    stdout: { on: (event, listener) => stdout.on(event, listener) },
    stderr: { on: (event, listener) => stderr.on(event, listener) },
    on: (event, listener) => events.on(event, listener),
    kill: () => {
      fake.killCalls += 1;
      return true;
    },
  };
}

function respond(fake: FakeChild, message: Record<string, unknown>, result: unknown): void {
  fake.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: message['id'], result })}\n`);
}

const TOOLS: McpTool[] = [
  { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
];

function autoChild(tools: McpTool[] = TOOLS): McpChild {
  return fakeChild((message, fake) => {
    switch (message['method']) {
      case 'initialize':
        respond(fake, message, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'fake' },
        });
        break;
      case 'tools/list':
        respond(fake, message, { tools });
        break;
      case 'tools/call':
        respond(fake, message, { content: [{ type: 'text', text: 'called' }] });
        break;
      default:
        break;
    }
  });
}

function failingChild(reason: string): McpChild {
  return fakeChild((_message, fake) => {
    queueMicrotask(() => fake.events.emit('error', new Error(reason)));
  });
}

describe('MCP service', () => {
  let ctx: TestContext;
  let server: McpServer;

  beforeEach(() => {
    ctx = createTestContext();
    server = ctx.repos.mcp.upsert({ label: 'files', command: 'fake-mcp', args: ['serve'] });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('tests a server and returns its tools', async () => {
    const service: McpService = createMcpService(ctx.repos, { spawnFn: () => autoChild() });

    await expect(service.test(server.id)).resolves.toEqual({
      ok: true,
      detail: 'Connected',
      tools: TOOLS,
    });
  });

  it('reports an unknown server without throwing', async () => {
    const service = createMcpService(ctx.repos, { spawnFn: () => autoChild() });

    const result = await service.test('mcp_missing');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not found');
    expect(result.tools).toEqual([]);
  });

  it('reports a spawn failure without throwing', async () => {
    const service = createMcpService(ctx.repos, { spawnFn: () => failingChild('spawn failed') });

    const result = await service.test(server.id);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('spawn failed');
    expect(result.tools).toEqual([]);
  });

  it('caches tools for 60 seconds and refreshes after the ttl', async () => {
    let nowMs = 1_000;
    const spawnFn = vi.fn(() => autoChild());
    const service = createMcpService(ctx.repos, { spawnFn, now: () => nowMs });

    await expect(service.listTools(server.id)).resolves.toEqual(TOOLS);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    await expect(service.listTools(server.id)).resolves.toEqual(TOOLS);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    nowMs += MCP_TOOL_CACHE_TTL_MS + 1_000;
    await expect(service.listTools(server.id)).resolves.toEqual(TOOLS);
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });

  it('clears the cache when a server is upserted', async () => {
    const spawnFn = vi.fn(() => autoChild());
    const service = createMcpService(ctx.repos, { spawnFn });

    await service.listTools(server.id);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    service.upsert({ id: server.id, label: 'renamed', command: 'fake-mcp' });
    await service.listTools(server.id);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(service.list()[0]?.label).toBe('renamed');
  });

  it('removes a server and its cache entry', async () => {
    const spawnFn = vi.fn(() => autoChild());
    const service = createMcpService(ctx.repos, { spawnFn });

    await service.listTools(server.id);
    service.remove(server.id);
    expect(service.list()).toEqual([]);
    await expect(service.listTools(server.id)).rejects.toThrow(/not found/);
  });

  it('refuses to call a tool on a disabled server', async () => {
    ctx.repos.mcp.upsert({ id: server.id, label: 'files', command: 'fake-mcp', enabled: false });
    const spawnFn = vi.fn(() => autoChild());
    const service = createMcpService(ctx.repos, { spawnFn });

    await expect(service.callTool(server.id, 'read_file', {})).rejects.toThrow(/disabled/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('calls a tool and returns its joined text', async () => {
    const child = autoChild();
    const service = createMcpService(ctx.repos, { spawnFn: () => child });

    await expect(service.callTool(server.id, 'read_file', { path: 'src' })).resolves.toBe('called');
  });
});

function fakeSecrets(): Pick<Secrets, 'get' | 'set'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

interface SeenRequest {
  method: string;
  authorization: string | undefined;
  apiKey: string | undefined;
}

/** A minimal streamable http MCP endpoint that records the credential headers. */
function startHttpMcp(
  tools: McpTool[] = TOOLS,
): Promise<{ url: string; server: Server; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const httpServer = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        id?: number;
        method?: string;
      };
      seen.push({
        method: request.method ?? '',
        authorization: request.headers.authorization,
        apiKey: request.headers['x-api-key'] as string | undefined,
      });
      if (request.method === 'DELETE' || message.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      const result =
        message.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {} }
          : { tools };
      const text = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(text);
    })();
  });
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server: httpServer, seen });
    });
  });
}

describe('MCP connector auth', () => {
  let ctx: TestContext;
  const httpServers: Server[] = [];

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(async () => {
    for (const httpServer of httpServers.splice(0)) {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    ctx.dispose();
  });

  it('sends a custom header for a bearer connector and never puts the value in the row', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const secrets = fakeSecrets();
    const service = createMcpService(ctx.repos, { secrets });

    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'bearer',
      authHeader: 'X-Api-Key',
      secret: 'key-1',
      secretPrefix: '',
    });

    expect(saved.authMode).toBe('bearer');
    expect(saved.authHeader).toBe('X-Api-Key');
    expect(saved.hasSecret).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('key-1');
    expect(secrets.values.get(`mcp:${saved.id}`)).toBe('key-1');

    await expect(service.test(saved.id)).resolves.toMatchObject({ ok: true });
    expect(remote.seen.every((entry) => entry.apiKey === 'key-1')).toBe(true);
    expect(remote.seen.every((entry) => entry.authorization === undefined)).toBe(true);
  });

  it('composes the prefix into the stored header value', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const service = createMcpService(ctx.repos, { secrets: fakeSecrets() });

    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'bearer',
      secret: 'token-1',
      secretPrefix: 'Bearer ',
    });

    await expect(service.test(saved.id)).resolves.toMatchObject({ ok: true });
    expect(remote.seen[0]?.authorization).toBe('Bearer token-1');
  });

  it('keeps the launch map header for an enabled bearer connector', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const service = createMcpService(ctx.repos, { secrets: fakeSecrets() });
    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'bearer',
      secret: 'token-1',
      secretPrefix: 'Bearer ',
    });

    expect(service.launchMap()[saved.label]).toEqual({
      type: 'http',
      url: remote.url,
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  it('clears the stored credential when the auth mode changes', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const secrets = fakeSecrets();
    const service = createMcpService(ctx.repos, { secrets });
    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'bearer',
      secret: 'token-1',
      secretPrefix: 'Bearer ',
    });

    const switched = await service.save({
      id: saved.id,
      label: saved.label,
      transport: 'http',
      url: remote.url,
      authMode: 'none',
    });
    expect(switched.authMode).toBe('none');
    expect(switched.hasSecret).toBe(false);
    expect(secrets.values.get(`mcp:${saved.id}`)).toBe('');
  });

  it('emits mcp.updated on save and remove', async () => {
    const bus = createEventBus();
    const events: { type: string; payload: unknown }[] = [];
    bus.subscribe((event) => events.push({ type: event.type, payload: event.payload }));
    const service = createMcpService(ctx.repos, { bus });

    const saved = await service.save({ label: 'files', command: 'fake-mcp' });
    service.remove(saved.id);

    expect(events.map((event) => event.type)).toEqual(['mcp.updated', 'mcp.updated']);
    expect(events[0]?.payload).toMatchObject({ id: saved.id, label: 'files' });
    expect(events[1]?.payload).toMatchObject({ id: saved.id, label: 'files' });
    expect(service.list()).toEqual([]);
  });

  it('reports a connector that needs sign-in instead of throwing', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const service = createMcpService(ctx.repos, { secrets: fakeSecrets() });
    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'oauth',
    });

    await expect(service.oauthStatus(saved.id)).resolves.toEqual({
      connected: false,
      needsAuth: false,
      expiresAt: null,
      authorizationServer: null,
    });
  });

  it('disconnects an oauth connector and clears its row reference', async () => {
    const remote = await startHttpMcp();
    httpServers.push(remote.server);
    const secrets = fakeSecrets();
    const bus = createEventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));
    const service = createMcpService(ctx.repos, { secrets, bus });
    const saved = await service.save({
      label: 'remote',
      transport: 'http',
      url: remote.url,
      authMode: 'oauth',
    });
    // The flow, not the form, writes the bundle; seed the same keychain entry it uses.
    secrets.values.set(`mcp:${saved.id}`, '{"accessToken":"access-1"}');
    const withSecret = ctx.repos.mcp.upsert({
      id: saved.id,
      label: saved.label,
      secretRef: `mcp:${saved.id}`,
    });
    expect(withSecret.hasSecret).toBe(true);

    await service.oauthDisconnect(saved.id);

    const row = ctx.repos.mcp.get(saved.id);
    expect(row?.hasSecret).toBe(false);
    expect(secrets.values.get(`mcp:${saved.id}`)).toBe('');
    expect(events).toContain('mcp.updated');
  });
});
