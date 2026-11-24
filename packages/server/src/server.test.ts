import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serverJsonPath } from '@tuffcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './server.js';
import { createTempEnv, type TempEnv } from './test-support.js';

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
  });
});
