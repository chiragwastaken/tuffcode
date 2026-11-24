import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer, isLoopbackAddress, isLoopbackHost } from './http.js';

function startTestServer(): Promise<{ server: Server; port: number }> {
  const server = createHttpServer({ version: '9.9.9', startedAt: Date.now() });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve({ server, port: (address as AddressInfo).port });
    });
  });
}

function requestWithHost(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('http surface', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    server = undefined;
  });

  it('serves health and 404s everything else', async () => {
    const started = await startTestServer();
    server = started.server;
    const health = await fetch(`http://127.0.0.1:${started.port}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    const body = (await health.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['version']).toBe('9.9.9');
    expect(body['pid']).toBe(process.pid);
    expect(typeof body['uptimeMs']).toBe('number');

    const missing = await fetch(`http://127.0.0.1:${started.port}/nope`);
    expect(missing.status).toBe(404);

    const wrongMethod = await fetch(`http://127.0.0.1:${started.port}/health`, {
      method: 'POST',
    });
    expect(wrongMethod.status).toBe(404);
  });

  it('rejects a non-loopback Host header', async () => {
    const started = await startTestServer();
    server = started.server;
    expect(await requestWithHost(started.port, '/health', 'evil.example')).toBe(403);
    expect(await requestWithHost(started.port, '/health', 'localhost:1234')).toBe(200);
  });

  it('classifies loopback addresses and hosts', () => {
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
  });
});
