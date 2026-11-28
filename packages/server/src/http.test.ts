import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_REMOTE_SETTINGS,
  PairClaimResultSchema,
  PairCreateResultSchema,
  REMOTE_SESSION_COOKIE,
  RemoteSessionListSchema,
  type RemoteSettings,
} from '@tuffcode/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createPairingStore,
  createSessionAuth,
  ensureToken,
  hashSecret,
  type PairingStore,
  type SessionAuth,
} from './auth.js';
import { migrate, openDb } from './db/index.js';
import { createRepos, type Repos } from './db/repos/index.js';
import {
  buildContentSecurityPolicy,
  createHttpServer,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackAddress,
  isLoopbackHost,
} from './http.js';
import { createTempEnv, type TempEnv } from './test-support.js';

const START = Date.parse('2026-01-01T00:00:00.000Z');

interface Harness {
  server: Server;
  port: number;
  token: string;
  repos: Repos;
  pairing: PairingStore;
  sessions: SessionAuth;
  remote: RemoteSettings;
  db: DatabaseSync;
  env: TempEnv;
  webRoot: string;
  now(): number;
  advance(ms: number): void;
  url(path: string): string;
  close(): Promise<void>;
}

function writeWebRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tuffcode-web-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'" /></head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("tuffcode");');
  return root;
}

async function startHarness(
  options: { remote?: Partial<RemoteSettings>; withWebRoot?: boolean } = {},
): Promise<Harness> {
  const env = createTempEnv();
  const db = openDb(join(env.root, 'http.db'));
  migrate(db);
  const repos = createRepos(db);
  const token = ensureToken();
  let nowMs = START;
  const pairing = createPairingStore({ now: () => nowMs });
  const sessions = createSessionAuth(repos.remoteSessions);
  const remote: RemoteSettings = { ...DEFAULT_REMOTE_SETTINGS, ...options.remote };
  const webRoot = options.withWebRoot === false ? undefined : writeWebRoot();
  const server = createHttpServer({
    version: '9.9.9',
    startedAt: START,
    webRoot,
    remote,
    sessions: repos.remoteSessions,
    pairing,
    verifyToken: (candidate) => candidate === token,
    verifySession: sessions.verify,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const port = (address as AddressInfo).port;
  return {
    server,
    port,
    token,
    repos,
    pairing,
    sessions,
    remote,
    db,
    env,
    webRoot: webRoot ?? '',
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      db.close();
      env.dispose();
      if (webRoot !== undefined) rmSync(webRoot, { recursive: true, force: true });
    },
  };
}

function requestWithHost(port: number, path: string, host: string): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const request = httpRequest(
    { host: '127.0.0.1', port, path, method: 'GET', headers: { host } },
    (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    },
  );
  request.on('error', reject);
  request.end();
  return promise;
}

function cookieToken(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${REMOTE_SESSION_COOKIE}=([0-9a-f]{64})`).exec(header);
  if (match?.[1] === undefined) throw new Error(`no session cookie in ${header}`);
  return match[1];
}

async function createCode(harness: Harness): Promise<string> {
  const response = await fetch(harness.url('/pair/create'), {
    method: 'POST',
    headers: { authorization: `Bearer ${harness.token}` },
  });
  expect(response.status).toBe(201);
  const body = PairCreateResultSchema.parse(await response.json());
  expect(body.url).toContain(`/pair?code=${body.code}`);
  expect(body.expiresAt).toBe(new Date(START + 5 * 60 * 1000).toISOString());
  return body.code;
}

async function claim(
  harness: Harness,
  code: string,
  deviceName = 'Pixel 9',
): Promise<Response> {
  return fetch(harness.url('/pair/claim'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName }),
  });
}

describe('http surface', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('serves health and 404s an unknown asset', async () => {
    harness = await startHarness();
    const health = await fetch(harness.url('/health'));
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    const body = z
      .object({
        ok: z.literal(true),
        version: z.string(),
        pid: z.number(),
        uptimeMs: z.number(),
      })
      .parse(await health.json());
    expect(body.ok).toBe(true);
    expect(body.version).toBe('9.9.9');
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptimeMs).toBe('number');

    const missing = await fetch(harness.url('/assets/missing.js'));
    expect(missing.status).toBe(404);

    const wrongMethod = await fetch(harness.url('/health'), { method: 'POST' });
    expect(wrongMethod.status).toBe(404);
  });

  it('serves a static asset and the SPA fallback with a request-origin CSP', async () => {
    harness = await startHarness();
    const asset = await fetch(harness.url('/assets/app.js'));
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await asset.text()).toContain('tuffcode');

    const shell = await fetch(harness.url('/'));
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(shell.headers.get('cache-control')).toBe('no-store');
    const csp = shell.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`ws://127.0.0.1:${harness.port}`);
    expect(csp).toContain(`http://127.0.0.1:${harness.port}`);
    const html = await shell.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(`ws://127.0.0.1:${harness.port}`);

    const route = await fetch(harness.url('/threads/thr_123'));
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<div id="root"></div>');
  });

  it('refuses a path that escapes the web root', async () => {
    harness = await startHarness();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: harness?.port ?? 0,
          path: '/..%2f..%2fpackage.json',
          method: 'GET',
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(404);
  });

  it('rejects a non-loopback Host header when remote access is off', async () => {
    harness = await startHarness();
    expect(await requestWithHost(harness.port, '/health', 'evil.example')).toBe(403);
    expect(await requestWithHost(harness.port, '/health', 'localhost:1234')).toBe(200);
  });

  it('accepts a LAN Host header when remote access is on and bound to a wildcard', async () => {
    harness = await startHarness({
      remote: { enabled: true, bindHost: '0.0.0.0', allowedOrigins: [] },
    });
    expect(await requestWithHost(harness.port, '/health', '192.168.1.20:4310')).toBe(200);
    expect(await requestWithHost(harness.port, '/health', 'rebind.example:4310')).toBe(403);
  });

  it('pairs once and stores only a hashed session', async () => {
    harness = await startHarness();
    const code = await createCode(harness);

    const wrong = await claim(harness, 'AAAAAAAA');
    expect(wrong.status).toBe(401);

    const first = await claim(harness, code.toLowerCase());
    expect(first.status).toBe(201);
    const setCookie = first.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    const token = cookieToken(first);
    const claimed = PairClaimResultSchema.parse(await first.json());
    expect(claimed.session.deviceName).toBe('Pixel 9');

    const stored = harness.repos.remoteSessions.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.deviceName).toBe('Pixel 9');
    expect(harness.sessions.verify(token)?.deviceName).toBe('Pixel 9');
    expect(harness.sessions.verify(`${token}0`)).toBeUndefined();

    const reused = await claim(harness, code);
    expect(reused.status).toBe(401);
  });

  it('rejects an expired pairing code', async () => {
    harness = await startHarness();
    const code = await createCode(harness);
    harness.advance(5 * 60 * 1000 + 1);
    expect((await claim(harness, code)).status).toBe(401);
  });

  it('rate limits pairing create and claim', async () => {
    harness = await startHarness();
    for (let index = 0; index < 5; index += 1) await createCode(harness);
    const limited = await fetch(harness.url('/pair/create'), {
      method: 'POST',
      headers: { authorization: `Bearer ${harness.token}` },
    });
    expect(limited.status).toBe(429);

    let lastStatus = 0;
    for (let index = 0; index < 11; index += 1) {
      lastStatus = (await claim(harness, 'AAAAAAAA')).status;
    }
    expect(lastStatus).toBe(429);
  });

  it('rejects a foreign Origin on claim and accepts an allowed one', async () => {
    harness = await startHarness({ remote: { enabled: true, bindHost: '0.0.0.0' } });
    const code = await createCode(harness);
    const foreign = await fetch(harness.url('/pair/claim'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ code, deviceName: 'Evil' }),
    });
    expect(foreign.status).toBe(403);

    const allowed = await startHarness({
      remote: {
        enabled: true,
        bindHost: '0.0.0.0',
        allowedOrigins: ['http://app.example'],
      },
    });
    try {
      const allowedCode = await createCode(allowed);
      const response = await fetch(allowed.url('/pair/claim'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://app.example' },
        body: JSON.stringify({ code: allowedCode, deviceName: 'Web' }),
      });
      expect(response.status).toBe(201);
    } finally {
      await allowed.close();
    }
  });

  it('revokes one session and all sessions with the bearer token', async () => {
    harness = await startHarness();
    const firstCode = await createCode(harness);
    const firstResponse = await claim(harness, firstCode, 'Phone');
    const firstToken = cookieToken(firstResponse);
    const firstId = PairClaimResultSchema.parse(await firstResponse.json()).session.id;
    const secondCode = await createCode(harness);
    const secondResponse = await claim(harness, secondCode, 'Tablet');
    const secondToken = cookieToken(secondResponse);

    const listed = await fetch(harness.url('/remote/sessions'), {
      headers: { authorization: `Bearer ${harness.token}` },
    });
    expect(listed.status).toBe(200);
    const sessions = RemoteSessionListSchema.parse(await listed.json());
    expect(sessions.sessions).toHaveLength(2);

    const revokeOne = await fetch(harness.url('/remote/sessions/revoke'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${harness.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: firstId }),
    });
    expect(revokeOne.status).toBe(200);
    expect(await revokeOne.json()).toEqual({ revoked: 1 });
    expect(harness.sessions.verify(firstToken)).toBeUndefined();
    expect(harness.sessions.verify(secondToken)?.deviceName).toBe('Tablet');

    const revokeAll = await fetch(harness.url('/remote/sessions/revoke'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${harness.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ all: true }),
    });
    expect(await revokeAll.json()).toEqual({ revoked: 1 });
    expect(harness.sessions.verify(secondToken)).toBeUndefined();

    const unauthorized = await fetch(harness.url('/remote/sessions'));
    expect(unauthorized.status).toBe(401);
  });

  it('classifies loopback addresses, hosts and origins', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.4.5.6')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);

    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost('127.0.0.1:5000')).toBe(true);
    expect(isLoopbackHost('localhost:5000')).toBe(true);
    expect(isLoopbackHost('[::1]:5000')).toBe(true);
    expect(isLoopbackHost('192.168.1.5:5000')).toBe(false);
    expect(isLoopbackHost('tuffcode.example')).toBe(false);

    const loopbackOnly = DEFAULT_REMOTE_SETTINGS;
    expect(isAllowedHost('192.168.1.5:4310', loopbackOnly)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:4310', '127.0.0.1:4310', loopbackOnly)).toBe(true);
    expect(isAllowedOrigin('http://evil.example', '127.0.0.1:4310', loopbackOnly)).toBe(false);
    expect(isAllowedOrigin(undefined, '127.0.0.1:4310', loopbackOnly)).toBe(true);

    const lan = { ...loopbackOnly, enabled: true, bindHost: '192.168.1.20' };
    expect(isAllowedHost('192.168.1.20:4310', lan)).toBe(true);
    expect(isAllowedOrigin('http://192.168.1.20:4310', '192.168.1.20:4310', lan)).toBe(true);
    expect(isAllowedOrigin('http://evil.example', '192.168.1.20:4310', lan)).toBe(false);
    expect(
      isAllowedOrigin('http://app.example', '192.168.1.20:4310', {
        ...lan,
        allowedOrigins: ['http://app.example/'],
      }),
    ).toBe(true);
  });

  it('builds a CSP that names the websocket origin', () => {
    const csp = buildContentSecurityPolicy('http://192.168.1.20:4310');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('connect-src \'self\' ws://192.168.1.20:4310 http://192.168.1.20:4310');
    expect(csp).toContain("object-src 'none'");
    expect(buildContentSecurityPolicy(undefined)).not.toContain('ws://');
  });

  it('hashes session tokens rather than storing them', async () => {
    harness = await startHarness();
    const code = await createCode(harness);
    const response = await claim(harness, code);
    const token = cookieToken(response);
    const row = harness.db.prepare('SELECT token_hash FROM remote_sessions').get();
    expect(row).toBeDefined();
    expect(row?.['token_hash']).toBe(hashSecret(token));
    expect(row?.['token_hash']).not.toBe(token);
  });
});
