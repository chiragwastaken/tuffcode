import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';

describe('mcp repo', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('inserts a server with empty args and env by default', () => {
    const server = ctx.repos.mcp.upsert({ label: 'filesystem', command: 'npx' });

    expect(server.id).toMatch(/^mcp_[0-9a-f]{16}$/);
    expect(server).toEqual({
      id: server.id,
      label: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      cwd: null,
      url: null,
      authMode: 'none',
      authHeader: 'Authorization',
      hasSecret: false,
      pluginId: null,
      enabled: true,
      createdAt: server.createdAt,
      updatedAt: server.createdAt,
    });
    expect(ctx.repos.mcp.list()).toEqual([server]);
    expect(ctx.repos.mcp.get(server.id)).toEqual(server);
    expect(ctx.repos.mcp.get('mcp_missing')).toBeUndefined();
  });

  it('stores an http server with a secret reference it never exposes', () => {
    const server = ctx.repos.mcp.upsert({
      label: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      secretRef: 'mcp-secret-1',
      pluginId: 'plg_1',
    });
    expect(server.transport).toBe('http');
    expect(server.command).toBe('');
    expect(server.hasSecret).toBe(true);
    expect(JSON.stringify(server)).not.toContain('mcp-secret-1');
    expect(ctx.repos.mcp.secretRef(server.id)).toBe('mcp-secret-1');
    expect(ctx.repos.mcp.listByPlugin('plg_1')).toEqual([server]);
    expect(ctx.repos.mcp.setEnabledByPlugin('plg_1', false)).toBe(1);
    expect(ctx.repos.mcp.get(server.id)?.enabled).toBe(false);
    const cleared = ctx.repos.mcp.upsert({ id: server.id, label: 'remote', secretRef: null });
    expect(cleared.hasSecret).toBe(false);
    expect(cleared.url).toBe('https://mcp.example.com/mcp');
  });

  it('maps a stored secret to bearer mode and keeps an explicit mode', () => {
    const implicit = ctx.repos.mcp.upsert({
      label: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      secretRef: 'mcp-secret-1',
    });
    expect(implicit.authMode).toBe('bearer');
    expect(implicit.authHeader).toBe('Authorization');

    const oauth = ctx.repos.mcp.upsert({
      id: implicit.id,
      label: 'remote',
      authMode: 'oauth',
      authHeader: 'X-Custom',
    });
    expect(oauth.authMode).toBe('oauth');
    expect(oauth.authHeader).toBe('X-Custom');
    expect(ctx.repos.mcp.list()[0]?.authMode).toBe('oauth');
  });

  it('updates by id and keeps the fields the caller omits', () => {
    const created = ctx.repos.mcp.upsert({
      label: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/work'],
      env: { DEBUG: '1' },
      cwd: 'C:/work',
      enabled: false,
    });

    const updated = ctx.repos.mcp.upsert({ id: created.id, label: 'files', command: 'node' });

    expect(updated).toEqual({
      ...created,
      label: 'files',
      command: 'node',
      updatedAt: updated.updatedAt,
    });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(ctx.repos.mcp.list()).toHaveLength(1);

    const cleared = ctx.repos.mcp.upsert({
      id: created.id,
      label: 'files',
      command: 'node',
      cwd: null,
      enabled: true,
    });
    expect(cleared.cwd).toBeNull();
    expect(cleared.enabled).toBe(true);
    expect(cleared.args).toEqual(created.args);
    expect(cleared.env).toEqual(created.env);
  });

  it('removes only the requested server', () => {
    const first = ctx.repos.mcp.upsert({ label: 'filesystem', command: 'npx' });
    const second = ctx.repos.mcp.upsert({ label: 'github', command: 'npx' });

    ctx.repos.mcp.remove(first.id);

    expect(ctx.repos.mcp.get(first.id)).toBeUndefined();
    expect(ctx.repos.mcp.list()).toEqual([second]);
    ctx.repos.mcp.remove('mcp_missing');
    expect(ctx.repos.mcp.list()).toEqual([second]);
  });

  it('stores args and env as JSON text without interpreting the values', () => {
    const label = "fs'); DROP TABLE mcp_servers; --";
    const server = ctx.repos.mcp.upsert({
      label,
      command: 'npx "quoted"',
      args: ['a b', "c'd", '-y'],
      env: { TOKEN: "a b'c", DEBUG: '1' },
    });

    expect(ctx.repos.mcp.get(server.id)).toEqual(server);
    const stored = ctx.db
      .prepare('SELECT args, env FROM mcp_servers WHERE id = ?')
      .get(server.id);
    expect(stored).toEqual({
      args: JSON.stringify(['a b', "c'd", '-y']),
      env: JSON.stringify({ TOKEN: "a b'c", DEBUG: '1' }),
    });
    expect(ctx.db.prepare('SELECT COUNT(*) AS total FROM mcp_servers').get()?.['total']).toBe(1);
  });

  it('rejects rows whose JSON columns are corrupt', () => {
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        'INSERT INTO mcp_servers (id, label, command, args, env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('mcp_broken', 'broken', 'npx', 'not json', '{}', now, now);
    ctx.db
      .prepare(
        'INSERT INTO mcp_servers (id, label, command, args, env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('mcp_shapes', 'shapes', 'npx', '["ok", 7]', '{"A": 1}', now, now);

    expect(() => ctx.repos.mcp.list()).toThrow('column args is not valid JSON');
    expect(() => ctx.repos.mcp.get('mcp_shapes')).toThrow('column args is not a string array');

    ctx.db.prepare("UPDATE mcp_servers SET args = '[]' WHERE id = 'mcp_shapes'").run();
    expect(() => ctx.repos.mcp.get('mcp_shapes')).toThrow('column env has a non-string value');
  });
});
