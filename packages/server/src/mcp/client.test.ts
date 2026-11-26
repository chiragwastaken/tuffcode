import { EventEmitter } from 'node:events';
import type { McpServer } from '@tuffcode/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_CLIENT_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_RESULT_LIMIT,
  createMcpClient,
  type McpChild,
  type McpSpawnOptions,
} from './client.js';

const spawnControl = vi.hoisted(() => ({
  calls: [] as { command: string; args: readonly string[]; options: Record<string, unknown> }[],
  child: null as unknown,
  treeKill: null as unknown,
}));

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
    spawnControl.calls.push({ command, args, options });
    const target = command === 'taskkill' ? spawnControl.treeKill : spawnControl.child;
    if (target === null) throw new Error(`unexpected spawn of ${command}`);
    return target;
  },
}));

const ISO = '2026-11-24T10:00:00.000Z';

interface FakeChild {
  writes: Record<string, unknown>[];
  stdin: EventEmitter;
  stdout: EventEmitter;
  stderr: EventEmitter;
  events: EventEmitter;
  killCalls: number;
}

interface Fake {
  fake: FakeChild;
  child: McpChild;
}

type OnMessage = (message: Record<string, unknown>, fake: FakeChild) => void;

function fakeChild(onMessage?: OnMessage): Fake {
  const stdin = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const events = new EventEmitter();
  const fake: FakeChild = { writes: [], stdin, stdout, stderr, events, killCalls: 0 };
  const child: McpChild = {
    stdin: {
      write: (chunk: string) => {
        const message = JSON.parse(chunk) as Record<string, unknown>;
        fake.writes.push(message);
        onMessage?.(message, fake);
        return true;
      },
      on: (event, listener) => stdin.on(event, listener),
    },
    stdout: { on: (event, listener) => stdout.on(event, listener) },
    stderr: { on: (event, listener) => stderr.on(event, listener) },
    on: (event, listener) => events.on(event, listener),
    kill: () => {
      fake.killCalls += 1;
      return true;
    },
  };
  return { fake, child };
}

interface TreeKillFake {
  unrefs: number;
  on(event: string, listener: (...args: unknown[]) => void): TreeKillFake;
  unref(): void;
}

function treeKillFake(): TreeKillFake {
  const fake: TreeKillFake = {
    unrefs: 0,
    on: () => fake,
    unref: () => {
      fake.unrefs += 1;
    },
  };
  return fake;
}

function respond(fake: FakeChild, message: Record<string, unknown>, result: unknown): void {
  fake.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: message['id'], result })}\n`);
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'mcp_test',
    label: 'test server',
    transport: 'stdio',
    command: 'fake-mcp',
    args: ['serve'],
    env: {},
    cwd: null,
    url: null,
    authMode: 'none',
    authHeader: 'Authorization',
    hasSecret: false,
    pluginId: null,
    enabled: true,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function initializer(fake: FakeChild, message: Record<string, unknown>): boolean {
  if (message['method'] !== 'initialize') return false;
  respond(fake, message, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    serverInfo: { name: 'fake' },
  });
  return true;
}

describe('MCP stdio client', () => {
  beforeEach(() => {
    spawnControl.calls.length = 0;
    spawnControl.child = null;
    spawnControl.treeKill = null;
  });

  it('spawns the configured command with the merged environment and sends the handshake', async () => {
    const { fake, child } = fakeChild((message, target) => {
      initializer(target, message);
    });
    let spawnArgs: readonly string[] = [];
    let spawnOptions: McpSpawnOptions | undefined;
    const client = createMcpClient(server({ env: { TOKEN: 'secret' }, cwd: 'C:/work' }), {
      spawnFn: (command, args, options) => {
        expect(command).toBe('fake-mcp');
        spawnArgs = args;
        spawnOptions = options;
        return child;
      },
    });

    await client.initialize();

    expect(spawnArgs).toEqual(['serve']);
    expect(spawnOptions?.env['TOKEN']).toBe('secret');
    expect(spawnOptions?.cwd).toBe('C:/work');
    expect(spawnOptions?.windowsHide).toBe(true);
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'tuffcode', version: MCP_CLIENT_VERSION },
      },
    });
    expect(fake.writes[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await client.close();
  });

  it('maps tools/list with defaults and drops tools without a name', async () => {
    const { fake, child } = fakeChild((message, target) => {
      if (initializer(target, message)) return;
      if (message['method'] === 'tools/list') {
        respond(target, message, {
          tools: [
            { name: 'alpha' },
            { description: 'missing a name' },
            { name: 'beta', description: 'Beta tool', inputSchema: { type: 'object' } },
          ],
        });
      }
    });
    const client = createMcpClient(server(), { spawnFn: () => child });

    const tools = await client.listTools();

    expect(tools).toEqual([
      { name: 'alpha', description: '', inputSchema: {} },
      { name: 'beta', description: 'Beta tool', inputSchema: { type: 'object' } },
    ]);
    expect(fake.writes[0]?.['method']).toBe('tools/list');
    await client.close();
  });

  it('joins text content, stringifies other content and caps the result', async () => {
    let reply = [
      { type: 'text', text: 'hello' },
      { type: 'image', data: { mimeType: 'image/png' } },
      { type: 'text', text: ' world' },
    ];
    const { fake, child } = fakeChild((message, target) => {
      if (initializer(target, message)) return;
      if (message['method'] === 'tools/call') respond(target, message, { content: reply });
    });
    const client = createMcpClient(server(), { spawnFn: () => child });

    const text = await client.callTool('read_file', { path: 'src' });
    expect(text).toBe('hello{"type":"image","data":{"mimeType":"image/png"}} world');
    expect(fake.writes[0]).toMatchObject({
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'src' } },
    });

    reply = [{ type: 'text', text: 'x'.repeat(MCP_RESULT_LIMIT + 5_000) }];
    const capped = await client.callTool('dump', {});
    expect(capped).toHaveLength(MCP_RESULT_LIMIT);
    await client.close();
  });

  it('rejects with the JSON-RPC error message and the method', async () => {
    const { child } = fakeChild((message, target) => {
      if (initializer(target, message)) return;
      target.stdout.emit(
        'data',
        `${JSON.stringify({ jsonrpc: '2.0', id: message['id'], error: { code: -32601, message: 'no such tool' } })}\n`,
      );
    });
    const client = createMcpClient(server(), { spawnFn: () => child });
    await client.initialize();

    await expect(client.callTool('missing', {})).rejects.toThrow(
      'MCP tools/call failed: no such tool',
    );
    await client.close();
  });

  it('times out a request and kills the child', async () => {
    const { fake, child } = fakeChild();
    const client = createMcpClient(server(), { spawnFn: () => child, timeoutMs: 20 });

    await expect(client.initialize()).rejects.toThrow(/timed out after 20ms/);
    expect(fake.killCalls).toBe(1);
    await client.close();
  });

  it('rejects pending requests on close and closes idempotently', async () => {
    const { fake, child } = fakeChild();
    const client = createMcpClient(server(), { spawnFn: () => child });

    const pending = expect(client.initialize()).rejects.toThrow(/closed/);
    await client.close();
    await pending;
    expect(fake.killCalls).toBe(1);
    await expect(client.close()).resolves.toBeUndefined();
    expect(fake.killCalls).toBe(1);
  });

  it('surfaces stderr as a short suffix when the child fails to spawn', async () => {
    const { fake, child } = fakeChild();
    const client = createMcpClient(server(), { spawnFn: () => child });

    const pending = expect(client.initialize()).rejects.toThrow(/spawn ENOENT/);
    fake.stderr.emit('data', 'boom: missing binary\n');
    fake.events.emit('error', new Error('spawn ENOENT'));
    await pending;
    await expect(client.initialize()).rejects.toThrow(/boom: missing binary/);
    await client.close();
  });

  it('absorbs a stdin error instead of throwing', async () => {
    const { fake, child } = fakeChild();
    spawnControl.child = child;
    const client = createMcpClient(server());

    expect(() => fake.stdin.emit('error', new Error('write EPIPE'))).not.toThrow();
    await client.close();
  });

  it('drops an over-long response line, fails the request and recovers', async () => {
    const oversized = 'x'.repeat(MCP_RESULT_LIMIT * 2 + 1);
    const tooLong = `MCP server sent a response line longer than ${MCP_RESULT_LIMIT * 2} bytes`;
    let calls = 0;
    const { child } = fakeChild((message, target) => {
      if (initializer(target, message)) return;
      calls += 1;
      if (calls === 1) {
        // No newline in the chunk: the buffer would grow without bound.
        target.stdout.emit('data', oversized);
        target.stdout.emit('data', `${'y'.repeat(64)}\n`);
        return;
      }
      if (calls === 2) {
        // The whole line arrives at once, so it is dropped as a completed line.
        target.stdout.emit('data', `${oversized}\n`);
        return;
      }
      respond(target, message, { tools: [{ name: 'recovered' }] });
    });
    const client = createMcpClient(server(), { spawnFn: () => child });

    await expect(client.listTools()).rejects.toThrow(tooLong);
    await expect(client.listTools()).rejects.toThrow(tooLong);
    await expect(client.listTools()).resolves.toEqual([
      { name: 'recovered', description: '', inputSchema: {} },
    ]);
    await client.close();
  });

  it('kills the whole tree with taskkill on win32', async () => {
    const { fake, child } = fakeChild();
    child.pid = 4242;
    const treeKill = treeKillFake();
    spawnControl.child = child;
    spawnControl.treeKill = treeKill;
    const client = createMcpClient(server(), { platform: 'win32' });

    await client.close();

    expect(spawnControl.calls).toContainEqual({
      command: 'taskkill',
      args: ['/pid', '4242', '/T', '/F'],
      options: { windowsHide: true },
    });
    expect(fake.killCalls).toBe(0);
    expect(treeKill.unrefs).toBe(1);
  });

  it('falls back to a plain kill off win32 or without a pid', async () => {
    const offWindows = fakeChild();
    offWindows.child.pid = 4242;
    spawnControl.child = offWindows.child;
    const linuxClient = createMcpClient(server(), { platform: 'linux' });
    await linuxClient.close();
    expect(offWindows.fake.killCalls).toBe(1);
    expect(spawnControl.calls.some((call) => call.command === 'taskkill')).toBe(false);

    const noPid = fakeChild();
    spawnControl.child = noPid.child;
    const windowsClient = createMcpClient(server(), { platform: 'win32' });
    await windowsClient.close();
    expect(noPid.fake.killCalls).toBe(1);
    expect(spawnControl.calls.some((call) => call.command === 'taskkill')).toBe(false);
  });
});
