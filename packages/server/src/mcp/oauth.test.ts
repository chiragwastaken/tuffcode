import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@tuffcode/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Secrets } from '../secrets/bridge.js';
import {
  createHttpMcpClient,
  type McpFetch,
} from './http-client.js';
import {
  createOAuthManager,
  createPkcePair,
  discoverAuthorizationServer,
  discoverResourceMetadata,
  OAUTH_REFRESH_SKEW_MS,
  parseResourceMetadataUrl,
  type OAuthManager,
  type OAuthTokenBundle,
} from './oauth.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type FakeSecrets = Pick<Secrets, 'get' | 'set'> & { values: Map<string, string> };

function fakeSecrets(): FakeSecrets {
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

function listen(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

async function form(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

interface MockAuthOptions {
  /** Access token lifetime in seconds; the default is an hour. */
  lifetime?: number;
  /** Reject the refresh grant with invalid_grant. */
  failRefresh?: boolean;
}

interface MockAuth {
  base: string;
  /** Authorization parameters seen at /authorize, keyed by code. */
  grants: Map<string, URLSearchParams>;
  refreshCalls: number;
  clientRegistrations: number;
}

/** A local authorization server: metadata, registration, authorize and token. */
async function startAuthServer(options: MockAuthOptions = {}): Promise<MockAuth> {
  const grants = new Map<string, URLSearchParams>();
  const state: MockAuth = { base: '', grants, refreshCalls: 0, clientRegistrations: 0 };
  let issued = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const base = state.base;
      if (url.pathname === '/mcp') {
        response.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        });
        response.end();
        return;
      }
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        json(response, 200, {
          resource: `${base}/mcp`,
          authorization_servers: [base],
          scopes_supported: ['mcp.read'],
        });
        return;
      }
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        json(response, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          scopes_supported: ['mcp.read'],
        });
        return;
      }
      if (url.pathname === '/register' && request.method === 'POST') {
        state.clientRegistrations += 1;
        json(response, 201, { client_id: 'client-1', client_secret: 'secret-1' });
        return;
      }
      if (url.pathname === '/authorize') {
        if (url.searchParams.get('deny') === '1') {
          const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
          redirect.searchParams.set('error', 'access_denied');
          redirect.searchParams.set('error_description', 'The user declined');
          redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
          response.writeHead(302, { location: redirect.toString() });
          response.end();
          return;
        }
        issued += 1;
        const code = `code-${issued}`;
        grants.set(code, url.searchParams);
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
        response.writeHead(302, { location: redirect.toString() });
        response.end();
        return;
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const body = await form(request);
        if (body.get('grant_type') === 'authorization_code') {
          const grant = grants.get(body.get('code') ?? '');
          if (grant === undefined) {
            json(response, 400, { error: 'invalid_grant' });
            return;
          }
          if (grant.get('client_id') !== body.get('client_id')) {
            json(response, 400, { error: 'invalid_client' });
            return;
          }
          if (grant.get('redirect_uri') !== body.get('redirect_uri')) {
            json(response, 400, { error: 'invalid_grant', error_description: 'redirect mismatch' });
            return;
          }
          const verifier = body.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (challenge !== grant.get('code_challenge')) {
            json(response, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
            return;
          }
          issued += 1;
          json(response, 200, {
            access_token: `access-${issued}`,
            token_type: 'Bearer',
            expires_in: options.lifetime ?? 3600,
            refresh_token: 'refresh-1',
            scope: grant.get('scope') ?? 'mcp.read',
          });
          return;
        }
        if (body.get('grant_type') === 'refresh_token') {
          state.refreshCalls += 1;
          if (options.failRefresh === true || body.get('refresh_token') !== 'refresh-1') {
            json(response, 400, { error: 'invalid_grant' });
            return;
          }
          issued += 1;
          json(response, 200, {
            access_token: `access-${issued}`,
            token_type: 'Bearer',
            expires_in: options.lifetime ?? 3600,
          });
          return;
        }
        json(response, 400, { error: 'unsupported_grant_type' });
        return;
      }
      response.writeHead(404);
      response.end();
    })();
  });
  state.base = await listen(server);
  return state;
}

function connector(base: string): McpServer {
  return {
    id: 'mcp_remote',
    label: 'remote',
    transport: 'http',
    command: '',
    args: [],
    env: {},
    cwd: null,
    url: `${base}/mcp`,
    authMode: 'oauth',
    authHeader: 'Authorization',
    hasSecret: false,
    pluginId: null,
    enabled: true,
    createdAt: '2026-11-26T10:00:00.000Z',
    updatedAt: '2026-11-26T10:00:00.000Z',
  };
}

function bundle(overrides: Partial<OAuthTokenBundle> = {}): OAuthTokenBundle {
  return {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    accessToken: 'access-old',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
    tokenEndpoint: 'http://127.0.0.1:1/token',
    authorizationServer: 'http://127.0.0.1:1',
    resource: 'http://127.0.0.1:1/mcp',
    ...overrides,
  };
}

async function finishSignIn(authorizeUrl: string, extra = ''): Promise<Response> {
  const url = new URL(authorizeUrl);
  const authorize = await fetch(url.toString() + extra, { redirect: 'manual' });
  const location = authorize.headers.get('location');
  if (location === null) throw new Error('the authorization server did not redirect');
  return fetch(location);
}

describe('OAuth discovery', () => {
  it('parses a resource_metadata URL out of a challenge', () => {
    expect(
      parseResourceMetadataUrl(
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", error="invalid_token"',
      ),
    ).toBe('https://mcp.example.com/.well-known/oauth-protected-resource');
    expect(parseResourceMetadataUrl('Bearer realm="mcp"')).toBeNull();
    expect(parseResourceMetadataUrl(null)).toBeNull();
  });

  it('honors the challenge URL, then the origin and path-suffixed documents', async () => {
    const asked: string[] = [];
    const fetchFn: McpFetch = (input) => {
      asked.push(input);
      if (input === 'https://mcp.example.com/.well-known/custom') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resource: 'https://mcp.example.com/mcp',
              authorization_servers: ['https://auth.example.com'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    };
    const metadata = await discoverResourceMetadata('https://mcp.example.com/mcp', {
      fetchFn,
      challenge: 'Bearer resource_metadata="https://mcp.example.com/.well-known/custom"',
    });
    expect(metadata.authorizationServers).toEqual(['https://auth.example.com']);
    expect(asked).toEqual(['https://mcp.example.com/.well-known/custom']);

    asked.length = 0;
    const pathOnly: McpFetch = (input) => {
      asked.push(input);
      if (input === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
        return Promise.resolve(
          new Response(JSON.stringify({ authorization_servers: ['https://auth.example.com'] }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('nope', { status: 404 }));
    };
    await expect(
      discoverResourceMetadata('https://mcp.example.com/mcp', { fetchFn: pathOnly }),
    ).resolves.toMatchObject({ authorizationServers: ['https://auth.example.com'] });
    expect(asked).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource',
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
    ]);
  });

  it('falls back from RFC 8414 metadata to the OpenID configuration', async () => {
    const fetchFn: McpFetch = (input) => {
      if (input === 'https://auth.example.com/.well-known/openid-configuration') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              issuer: 'https://auth.example.com',
              authorization_endpoint: 'https://auth.example.com/authorize',
              token_endpoint: 'https://auth.example.com/token',
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('nope', { status: 404 }));
    };
    await expect(discoverAuthorizationServer('https://auth.example.com', fetchFn)).resolves.toEqual({
      issuer: 'https://auth.example.com',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: null,
      scopesSupported: [],
    });
  });

  it('produces an S256 pair', () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
  });
});

describe('OAuth flow against a local authorization server', () => {
  it('registers, signs in with PKCE, and stores the bundle in the keychain', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const updates: string[] = [];
    const manager = createOAuthManager({ secrets, onUpdate: (id) => updates.push(id) });
    const server = connector(auth.base);

    const flow = await manager.start(server);
    const url = new URL(flow.authorizeUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('scope')).toBe('mcp.read');
    expect(url.searchParams.get('resource')).toBe(`${auth.base}/mcp`);
    expect(auth.clientRegistrations).toBe(1);

    const page = await finishSignIn(flow.authorizeUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Connected');

    const stored = secrets.values.get('mcp:mcp_remote');
    expect(stored).toBeDefined();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      clientId: 'client-1',
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      resource: `${auth.base}/mcp`,
    });
    expect(updates).toEqual(['mcp_remote']);
    await expect(manager.status(server)).resolves.toMatchObject({
      connected: true,
      needsAuth: false,
      authorizationServer: auth.base,
    });
    await expect(manager.headerValue(server)).resolves.toBe('Bearer access-2');
  });

  it('rejects a callback whose state does not match', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const manager = createOAuthManager({ secrets });
    const flow = await manager.start(connector(auth.base));
    const url = new URL(flow.authorizeUrl);
    const redirect = url.searchParams.get('redirect_uri') ?? '';

    const page = await fetch(`${redirect}?code=code-1&state=forged`);
    expect(page.status).toBe(400);
    expect(await page.text()).toContain('did not match');
    expect(secrets.values.get('mcp:mcp_remote')).toBeUndefined();
  });

  it('handles access_denied without storing a token', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const manager = createOAuthManager({ secrets });
    const flow = await manager.start(connector(auth.base));
    const page = await finishSignIn(flow.authorizeUrl, '&deny=1');
    expect(page.status).toBe(400);
    expect(await page.text()).toContain('declined');
    expect(secrets.values.get('mcp:mcp_remote')).toBeUndefined();
  });

  it('cancels the previous listener when a second flow starts', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const manager = createOAuthManager({ secrets });
    const server = connector(auth.base);
    const first = await manager.start(server);
    const firstRedirect = new URL(first.authorizeUrl).searchParams.get('redirect_uri') ?? '';
    const second = await manager.start(server);
    await expect(fetch(firstRedirect)).rejects.toThrow();
    const page = await finishSignIn(second.authorizeUrl);
    expect(page.status).toBe(200);
    expect(secrets.values.get('mcp:mcp_remote')).toBeDefined();
  });

  it('closes a flow that is never completed', async () => {
    const auth = await startAuthServer();
    const manager = createOAuthManager({ secrets: fakeSecrets(), callbackTimeoutMs: 40 });
    const flow = await manager.start(connector(auth.base));
    const redirect = new URL(flow.authorizeUrl).searchParams.get('redirect_uri') ?? '';
    // Real timer on purpose: this asserts a real loopback listener stops accepting after
    // its timeout, which fake timers cannot prove because the socket close is async.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it('refreshes before expiry and persists the new token', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const tokenEndpoint = `${auth.base}/token`;
    secrets.values.set(
      'mcp:mcp_remote',
      JSON.stringify(
        bundle({
          accessToken: 'access-old',
          expiresAt: Date.now() + OAUTH_REFRESH_SKEW_MS / 2,
          tokenEndpoint,
          authorizationServer: auth.base,
          resource: `${auth.base}/mcp`,
        }),
      ),
    );
    const manager = createOAuthManager({ secrets });
    const server = connector(auth.base);
    await expect(manager.headerValue(server)).resolves.toBe('Bearer access-1');
    expect(auth.refreshCalls).toBe(1);
    const stored = JSON.parse(secrets.values.get('mcp:mcp_remote') ?? '{}') as OAuthTokenBundle;
    expect(stored.accessToken).toBe('access-1');
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + OAUTH_REFRESH_SKEW_MS);
  });

  it('retries once after a 401 by refreshing the token', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const mcp = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
          id?: number;
          method?: string;
        };
        const authorization = request.headers.authorization ?? '';
        if (request.method === 'DELETE' || message.id === undefined) {
          response.writeHead(202);
          response.end();
          return;
        }
        if (authorization !== 'Bearer access-1') {
          response.writeHead(401, { 'www-authenticate': 'Bearer error="invalid_token"' });
          response.end();
          return;
        }
        const result =
          message.method === 'initialize'
            ? { protocolVersion: '2025-06-18', capabilities: {} }
            : { tools: [{ name: 'search', description: 's', inputSchema: { type: 'object' } }] };
        const text = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(text);
      })();
    });
    const mcpBase = await listen(mcp);
    secrets.values.set(
      'mcp:mcp_remote',
      JSON.stringify(
        bundle({
          accessToken: 'access-old',
          expiresAt: Date.now() + 3_600_000,
          tokenEndpoint: `${auth.base}/token`,
          authorizationServer: auth.base,
          resource: `${mcpBase}/mcp`,
        }),
      ),
    );
    const manager: OAuthManager = createOAuthManager({ secrets });
    const server = { ...connector(mcpBase), url: `${mcpBase}/mcp` };
    const client = createHttpMcpClient({
      url: `${mcpBase}/mcp`,
      auth: {
        headers: async () => ({ authorization: (await manager.headerValue(server)) ?? '' }),
        refresh: () => manager.refresh(server),
      },
    });
    await client.initialize();
    await expect(client.listTools()).resolves.toEqual([
      { name: 'search', description: 's', inputSchema: { type: 'object' } },
    ]);
    expect(auth.refreshCalls).toBe(1);
  });

  it('marks the connector as needing sign-in when refresh fails', async () => {
    const auth = await startAuthServer({ failRefresh: true });
    const secrets = fakeSecrets();
    secrets.values.set(
      'mcp:mcp_remote',
      JSON.stringify(
        bundle({
          expiresAt: Date.now() + OAUTH_REFRESH_SKEW_MS / 2,
          tokenEndpoint: `${auth.base}/token`,
          authorizationServer: auth.base,
        }),
      ),
    );
    const manager = createOAuthManager({ secrets });
    const server = connector(auth.base);
    await expect(manager.accessToken(server)).resolves.toBeNull();
    await expect(manager.status(server)).resolves.toMatchObject({ needsAuth: true });
  });

  it('clears the keychain value on disconnect', async () => {
    const auth = await startAuthServer();
    const secrets = fakeSecrets();
    const manager = createOAuthManager({ secrets });
    const server = connector(auth.base);
    await finishSignIn((await manager.start(server)).authorizeUrl);
    expect(secrets.values.get('mcp:mcp_remote')).toContain('access-');
    await manager.disconnect(server);
    expect(secrets.values.get('mcp:mcp_remote')).toBe('');
    await expect(manager.status(server)).resolves.toMatchObject({ connected: false });
    await expect(manager.headerValue(server)).resolves.toBeNull();
  });
});
