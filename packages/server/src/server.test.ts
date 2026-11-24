import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serverJsonPath } from '@tuffcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, migrate, openDb } from './db/index.js';
import { createRepos } from './db/repos/index.js';
import { startServer, type RunningServer } from './server.js';
import type { SecretPort } from './secrets/bridge.js';
import { createTempEnv, type TempEnv } from './test-support.js';

const ISO = '2026-11-24T10:00:00.000Z';

interface FakePort extends SecretPort {
  sent: unknown[];
  reply(message: unknown): void;
}

function createFakePort(): FakePort {
  const listeners: ((message?: unknown) => void)[] = [];
  const sent: unknown[] = [];
  return {
    sent,
    postMessage: (message) => {
      sent.push(message);
    },
    on: (event, listener) => {
      if (event === 'message') listeners.push(listener);
    },
    reply: (message) => {
      for (const listener of listeners) listener(message);
    },
  };
}

/** Seeds one thread with a running turn, as a crash mid-turn would leave it. */
function seedOrphan(dbFile: string): void {
  const db = openDb(dbFile);
  migrate(db);
  const repos = createRepos(db);
  repos.projects.add({
    id: 'prj_a',
    name: 'alpha',
    path: 'C:/tmp/alpha',
    defaultBranch: 'main',
    createdAt: ISO,
  });
  repos.providers.upsert({ id: 'prv_a', kind: 'claude', label: 'Test', config: {} });
  repos.threads.create({
    id: 'thr_a',
    projectId: 'prj_a',
    parentThreadId: null,
    title: 'thread',
    providerId: 'prv_a',
    modelId: 'model-x',
    executionMode: 'work',
    permissionMode: 'ask',
    status: 'running',
    worktreePath: 'C:/tmp/alpha',
    branch: null,
    baseBranch: null,
    createdAt: ISO,
    updatedAt: ISO,
  });
  repos.turns.create({
    id: 'turn_a',
    threadId: 'thr_a',
    status: 'running',
    injectedIds: [],
    createdAt: ISO,
  });
  closeDb(db);
}

describe('server bootstrap', () => {
  let env: TempEnv | undefined;
  let running: RunningServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
    env?.dispose();
    env = undefined;
  });

  it('writes the server.json handshake and serves health on the bound port', async () => {
    env = createTempEnv();
    running = await startServer({ version: '2.0.0', dbFile: join(env.root, 'server.db') });

    const file = serverJsonPath();
    const info = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(info['port']).toBe(running.port);
    expect(info['token']).toBe(running.token);
    expect(info['pid']).toBe(process.pid);
    expect(typeof info['startedAt']).toBe('number');
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }

    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['version']).toBe('2.0.0');
  });

  it('closes idempotently', async () => {
    env = createTempEnv();
    running = await startServer({
      version: '2.0.0',
      dbFile: join(env.root, 'server.db'),
      writeServerJson: false,
    });
    const server = running;
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
    expect(server.httpServer.listening).toBe(false);
    expect(server.runner.listActive()).toEqual([]);
  });

  it('registers the terminal handlers from the pty slice', async () => {
    env = createTempEnv();
    running = await startServer({
      dbFile: join(env.root, 'server.db'),
      writeServerJson: false,
    });

    for (const method of ['terminal.open', 'terminal.input', 'terminal.resize', 'terminal.close']) {
      expect(running.handlers.has(method)).toBe(true);
    }
  });

  it('registers the council handlers', async () => {
    env = createTempEnv();
    running = await startServer({
      dbFile: join(env.root, 'server.db'),
      writeServerJson: false,
    });

    for (const method of ['council.start', 'council.cancel', 'council.status']) {
      expect(running.handlers.has(method)).toBe(true);
    }
  });

  it('wires the secret bridge and the runner from a parent port', async () => {
    env = createTempEnv();
    const port = createFakePort();
    running = await startServer({
      dbFile: join(env.root, 'server.db'),
      writeServerJson: false,
      parentPort: port,
    });

    expect(running.secrets.available).toBe(true);
    expect(running.runner.listActive()).toEqual([]);
    expect(running.providers.list()).toEqual([]);

    const pending = running.secrets.get('provider:prv_a');
    const request = port.sent[0] as Record<string, unknown>;
    expect(request).toMatchObject({ type: 'secret.get', key: 'provider:prv_a' });
    port.reply({ id: request['id'], type: 'secret.result', ok: true, value: 'sk-from-main' });
    await expect(pending).resolves.toBe('sk-from-main');
  });

  it('fails an orphaned running turn during startup recovery', async () => {
    env = createTempEnv();
    const dbFile = join(env.root, 'server.db');
    seedOrphan(dbFile);

    running = await startServer({ dbFile, writeServerJson: false });

    expect(running.repos.turns.get('turn_a')).toMatchObject({ status: 'failed' });
    expect(running.repos.threads.get('thr_a')?.status).toBe('failed');
    const rows = running.repos.events.since('thr_a', 0, 10);
    expect(rows.map((row) => row.type)).toEqual(['error', 'turn.finished']);
    expect(rows[1]?.payload).toEqual({
      type: 'turn.finished',
      turnId: 'turn_a',
      reason: 'error',
    });
  });
});
