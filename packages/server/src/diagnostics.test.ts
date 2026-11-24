import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from './events.js';
import { createRunner } from './runner/runner.js';
import { createSecretBridge } from './secrets/bridge.js';
import { createTestContext, silentLogger, type TestContext } from './test-support.js';
import { createWarningLog, exportDiagnostics } from './diagnostics.js';

const ISO = '2026-11-24T10:00:00.000Z';

describe('diagnostics export', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.providers.upsert({
      id: 'prv_a',
      kind: 'openai-compatible',
      label: 'API',
      config: { baseUrl: 'https://api.example.com' },
      secretRef: 'provider:prv_a',
    });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'thread',
      providerId: 'prv_a',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'ready-to-review',
      worktreePath: ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
    ctx.repos.messages.add({
      id: 'msg_a',
      threadId: 'thr_a',
      role: 'user',
      content: 'super-secret-message-text',
      createdAt: ISO,
    });
    ctx.repos.events.append('thr_a', 'turn.started', { type: 'turn.started', turnId: 'turn_a' });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('writes a parseable snapshot without secrets or message text', () => {
    const bus = createEventBus();
    const runner = createRunner({
      repos: ctx.repos,
      bus,
      logger: silentLogger(),
      secrets: createSecretBridge(undefined),
      settings: () => ctx.repos.settings.get(),
      createAdapter: async () => {
        throw new Error('unreachable');
      },
    });
    const warnings = createWarningLog();
    warnings.push('pty backend unavailable');

    const result = exportDiagnostics({
      version: '2.0.0',
      startedAt: Date.now() - 1_000,
      dbPath: ctx.env.root,
      repos: ctx.repos,
      runner,
      warnings: () => warnings.list(),
      secretBridgeAvailable: false,
    });

    expect(isAbsolute(result.path)).toBe(true);
    expect(result.path).toMatch(/diagnostics-.*\.json$/);
    const text = readFileSync(result.path, 'utf8');
    const payload = JSON.parse(text) as Record<string, unknown>;

    expect(payload['schemaVersion']).toBe(2);
    expect(payload['appVersion']).toBe('2.0.0');
    expect(payload['dbPath']).toBe(ctx.env.root);
    expect(payload['secretBridgeAvailable']).toBe(false);
    expect(payload['providers']).toEqual([
      expect.objectContaining({ id: 'prv_a', hasSecret: true }),
    ]);
    expect(payload['counts']).toEqual({
      projects: 1,
      threads: { total: 1, byStatus: { 'ready-to-review': 1 } },
      events: 1,
    });
    expect(payload['activeRuns']).toEqual([]);
    expect(payload['warnings']).toEqual(['pty backend unavailable']);
    expect(payload['settings']).toMatchObject({ theme: 'dark' });

    expect(text).not.toContain('super-secret-message-text');
    expect(text).not.toContain('sk-');
    if (process.platform !== 'win32') {
      expect(statSync(result.path).mode & 0o777).toBe(0o600);
    }
  });

  it('reports active run ids', () => {
    const result = exportDiagnostics({
      version: '2.0.0',
      startedAt: Date.now(),
      dbPath: ctx.env.root,
      repos: ctx.repos,
      runner: {
        listActive: () => [{ threadId: 'thr_a', turnId: 'turn_a', adapterKey: 'prv_a:model-x' }],
      },
      secretBridgeAvailable: true,
    });
    const payload = JSON.parse(readFileSync(result.path, 'utf8')) as Record<string, unknown>;
    expect(payload['activeRuns']).toEqual([
      { threadId: 'thr_a', turnId: 'turn_a', adapterKey: 'prv_a:model-x' },
    ]);
    expect(payload['secretBridgeAvailable']).toBe(true);
  });
});
