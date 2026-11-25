import { EventEmitter } from 'node:events';
import type { McpServer, McpTool } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
