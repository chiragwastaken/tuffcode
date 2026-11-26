import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@tuffcode/contracts';
import { badRequest } from '../errors.js';
import type { Secrets } from '../secrets/bridge.js';
import type { McpFetch } from './http-client.js';

/**
 * OAuth 2.1 for remote MCP connectors: RFC 9728 resource metadata, RFC 8414
 * authorization server metadata, RFC 7591 dynamic client registration, and the
 * authorization code grant with PKCE S256 on a loopback redirect. Everything here is
 * `node:crypto`, `node:http` and `fetch`; there is no OAuth dependency.
 *
 * The token bundle lives in the OS keychain under the connector's `mcp:<id>` key as one
 * JSON value. Nothing in this module writes a token to the database, a log, or an event.
 */
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60_000;
export const OAUTH_REFRESH_SKEW_MS = 60_000;
export const OAUTH_CALLBACK_PATH = '/callback';
const CLIENT_NAME = 'Tuffcode';
const BODY_LIMIT = 1024 * 1024;

export interface OAuthTokenBundle {
  clientId: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds; the access token is refreshed shortly before this. */
  expiresAt: number;
  tokenEndpoint: string;
  authorizationServer: string;
  resource: string;
  scope?: string;
}

export interface OAuthStatus {
  connected: boolean;
  needsAuth: boolean;
  expiresAt: string | null;
  authorizationServer: string | null;
}

export interface ResourceMetadata {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scopesSupported: string[];
}

export interface OAuthFlowStart {
  flowId: string;
  authorizeUrl: string;
}

export interface OAuthStartInput {
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthManagerDeps {
  secrets: Pick<Secrets, 'get' | 'set'>;
  fetchFn?: McpFetch;
  now?: () => number;
  callbackTimeoutMs?: number;
  /** Called after tokens are stored, refreshed or dropped so the service can emit. */
  onUpdate?: (serverId: string) => void;
}

export interface OAuthManager {
  start(server: McpServer, input?: OAuthStartInput): Promise<OAuthFlowStart>;
  status(server: McpServer): Promise<OAuthStatus>;
  disconnect(server: McpServer): Promise<void>;
  /** The stored access token, refreshed when it is within the skew of expiry. */
  accessToken(server: McpServer): Promise<string | null>;
  /** Header value for one request, for example `Bearer ey...`; null when signed out. */
  headerValue(server: McpServer): Promise<string | null>;
  /** Refreshes after a 401; false means the connector needs a new sign-in. */
  refresh(server: McpServer): Promise<boolean>;
  /** Loads a stored bundle into memory so the sync launch map can read it. */
  warm(server: McpServer): Promise<void>;
  /** Cached header value without awaiting; empty until `warm` or a flow completed. */
  cachedHeaderValue(server: McpServer): string | null;
  dispose(): void;
}

export function secretKeyFor(serverId: string): string {
  return `mcp:${serverId}`;
}

function base64url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE pair; the verifier is 43 characters, which S256 accepts. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function trimSlash(path: string): string {
  return path === '/' ? '' : path.replace(/\/$/, '');
}

/** Reads a JSON body up to the cap; a larger or non-JSON body is an error. */
async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
  if (response.body === null) throw new Error(`${what} answered with an empty body`);
  const text = await response.text();
  if (text.length > BODY_LIMIT) throw new Error(`${what} answered with an oversized body`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} did not answer with JSON`, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${what} did not answer with a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function getJson(url: string, fetchFn: McpFetch, what: string): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${what} answered with status ${response.status}`);
  }
  return readJson(response, what);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function requiredString(body: Record<string, unknown>, key: string, what: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${what} did not include ${key}`);
  }
  return value;
}

/**
 * Pulls the `resource_metadata` URL out of a `WWW-Authenticate` challenge, for example
 * `Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"`.
 */
export function parseResourceMetadataUrl(challenge: string | null | undefined): string | null {
  if (typeof challenge !== 'string') return null;
  const match = /resource_metadata\s*=\s*(?:"([^"]+)"|([^\s,]+))/i.exec(challenge);
  const raw = match?.[1] ?? match?.[2];
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Reads a protected resource metadata document, or null when it is unusable. */
function parseResourceMetadata(body: Record<string, unknown>): ResourceMetadata | null {
  const servers = stringList(body['authorization_servers']);
  if (servers.length === 0) return null;
  const resource = typeof body['resource'] === 'string' ? body['resource'] : '';
  return { resource, authorizationServers: servers, scopesSupported: stringList(body['scopes_supported']) };
}

/**
 * RFC 9728 discovery: the URL named by a 401 challenge first, then the origin-level
 * document, then the path-suffixed variant the spec defines for a resource with a path.
 */
export async function discoverResourceMetadata(
  resourceUrl: string,
  options: { fetchFn: McpFetch; challenge?: string | null },
): Promise<ResourceMetadata> {
  const resource = new URL(resourceUrl);
  const candidates: string[] = [];
  const fromChallenge = parseResourceMetadataUrl(options.challenge);
  if (fromChallenge !== null) candidates.push(fromChallenge);
  candidates.push(`${resource.origin}/.well-known/oauth-protected-resource`);
  const path = trimSlash(resource.pathname);
  if (path.length > 0) {
    candidates.push(`${resource.origin}/.well-known/oauth-protected-resource${path}`);
  }
  for (const candidate of candidates) {
    try {
      const parsed = parseResourceMetadata(
        await getJson(candidate, options.fetchFn, 'protected resource metadata'),
      );
      if (parsed !== null) return { ...parsed, resource: parsed.resource || resource.toString() };
    } catch {
      // Try the next well-known location.
    }
  }
  throw new Error('the MCP server did not publish OAuth protected resource metadata');
}

/** RFC 8414 discovery, with the OpenID configuration document as the fallback. */
export async function discoverAuthorizationServer(
  issuer: string,
  fetchFn: McpFetch,
): Promise<AuthorizationServerMetadata> {
  let base: URL;
  try {
    base = new URL(issuer);
  } catch {
    throw new Error('the authorization server issuer is not a valid URL');
  }
  const path = trimSlash(base.pathname);
  const candidates = [
    `${base.origin}/.well-known/oauth-authorization-server${path}`,
    `${base.origin}${path}/.well-known/openid-configuration`,
    `${base.origin}/.well-known/openid-configuration`,
  ];
  for (const candidate of candidates) {
    try {
      const body = await getJson(candidate, fetchFn, 'authorization server metadata');
      if (typeof body['authorization_endpoint'] !== 'string' || typeof body['token_endpoint'] !== 'string') {
        continue;
      }
      return {
        issuer: typeof body['issuer'] === 'string' ? body['issuer'] : issuer,
        authorizationEndpoint: body['authorization_endpoint'],
        tokenEndpoint: body['token_endpoint'],
        registrationEndpoint:
          typeof body['registration_endpoint'] === 'string' ? body['registration_endpoint'] : null,
        scopesSupported: stringList(body['scopes_supported']),
      };
    } catch {
      // Try the next well-known location.
    }
  }
  throw new Error('the authorization server did not publish metadata');
}

/** RFC 7591 registration; the redirect URI is a loopback listener bound to port 0. */
export async function registerOAuthClient(
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
  fetchFn: McpFetch,
): Promise<{ clientId: string; clientSecret?: string }> {
  if (metadata.registrationEndpoint === null) {
    throw badRequest(
      'this authorization server does not support dynamic client registration; enter a client id instead',
    );
  }
  const response = await fetchFn(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`client registration failed with status ${response.status}`);
  }
  const body = await readJson(response, 'client registration');
  const clientId = requiredString(body, 'client_id', 'client registration');
  const secret = typeof body['client_secret'] === 'string' ? body['client_secret'] : undefined;
  return { clientId, ...(secret === undefined ? {} : { clientSecret: secret }) };
}

interface PendingFlow {
  flowId: string;
  serverId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  authorizationServer: string;
  resource: string;
  scope?: string;
  listener: Server;
  timer: NodeJS.Timeout;
}

function successPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tuffcode connected</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem">
<h1>Connected</h1><p>Tuffcode has the access token. You can close this tab and return to the app.</p>
</body></html>`;
}

function failurePage(message: string): string {
  const safe = message.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tuffcode sign-in failed</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem">
<h1>Sign-in failed</h1><p>${safe}</p><p>Return to Tuffcode and try again.</p>
</body></html>`;
}

function page(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function tokenExpiry(now: number, body: Record<string, unknown>): number {
  const seconds = body['expires_in'];
  const lifetime = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  return now + lifetime * 1000;
}

function bundleFromTokenResponse(
  body: Record<string, unknown>,
  base: {
    clientId: string;
    clientSecret?: string;
    tokenEndpoint: string;
    authorizationServer: string;
    resource: string;
    scope?: string;
    now: number;
    previousRefreshToken?: string;
  },
): OAuthTokenBundle {
  const accessToken = requiredString(body, 'access_token', 'the token endpoint');
  const refreshToken =
    typeof body['refresh_token'] === 'string'
      ? body['refresh_token']
      : base.previousRefreshToken;
  const scope = typeof body['scope'] === 'string' ? body['scope'] : base.scope;
  return {
    clientId: base.clientId,
    ...(base.clientSecret === undefined ? {} : { clientSecret: base.clientSecret }),
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    expiresAt: tokenExpiry(base.now, body),
    tokenEndpoint: base.tokenEndpoint,
    authorizationServer: base.authorizationServer,
    resource: base.resource,
    ...(scope === undefined ? {} : { scope }),
  };
}

function isBundle(value: unknown): value is OAuthTokenBundle {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['clientId'] === 'string' &&
    typeof record['accessToken'] === 'string' &&
    typeof record['expiresAt'] === 'number' &&
    typeof record['tokenEndpoint'] === 'string' &&
    typeof record['authorizationServer'] === 'string' &&
    typeof record['resource'] === 'string'
  );
}

function parseBundle(raw: string | null): OAuthTokenBundle | null {
  if (raw === null || !raw.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBundle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createOAuthManager(deps: OAuthManagerDeps): OAuthManager {
  const fetchFn: McpFetch = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const callbackTimeoutMs = deps.callbackTimeoutMs ?? OAUTH_CALLBACK_TIMEOUT_MS;
  const bundles = new Map<string, OAuthTokenBundle | null>();
  const pending = new Map<string, PendingFlow>();
  const refreshing = new Map<string, Promise<boolean>>();
  const needsAuth = new Set<string>();

  async function readBundle(server: McpServer): Promise<OAuthTokenBundle | null> {
    const cached = bundles.get(server.id);
    if (cached !== undefined) return cached;
    const raw = await deps.secrets.get(secretKeyFor(server.id)).catch(() => null);
    const bundle = parseBundle(raw);
    bundles.set(server.id, bundle);
    return bundle;
  }

  async function writeBundle(serverId: string, bundle: OAuthTokenBundle | null): Promise<void> {
    bundles.set(serverId, bundle);
    await deps.secrets.set(secretKeyFor(serverId), bundle === null ? '' : JSON.stringify(bundle));
  }

  function closeFlow(flow: PendingFlow): void {
    clearTimeout(flow.timer);
    pending.delete(flow.serverId);
    flow.listener.close();
  }

  function cancelPending(serverId: string): void {
    const flow = pending.get(serverId);
    if (flow !== undefined) closeFlow(flow);
  }

  /** The 401 challenge from a plain initialize attempt, used only for discovery. */
  async function challengeOf(server: McpServer): Promise<string | null> {
    if (server.url === null) return null;
    try {
      const response = await fetchFn(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 401) return null;
      return response.headers.get('www-authenticate');
    } catch {
      return null;
    }
  }

  async function exchangeCode(flow: PendingFlow, code: string): Promise<OAuthTokenBundle> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
      code_verifier: flow.verifier,
      resource: flow.resource,
    });
    if (flow.clientSecret !== undefined) body.set('client_secret', flow.clientSecret);
    const response = await fetchFn(flow.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`the token endpoint answered with status ${response.status}`);
    }
    const parsed = await readJson(response, 'the token endpoint');
    return bundleFromTokenResponse(parsed, {
      clientId: flow.clientId,
      ...(flow.clientSecret === undefined ? {} : { clientSecret: flow.clientSecret }),
      tokenEndpoint: flow.tokenEndpoint,
      authorizationServer: flow.authorizationServer,
      resource: flow.resource,
      ...(flow.scope === undefined ? {} : { scope: flow.scope }),
      now: now(),
    });
  }

  async function handleCallback(flow: PendingFlow, url: URL, response: ServerResponse): Promise<void> {
    const state = url.searchParams.get('state');
    if (state !== flow.state) {
      page(response, 400, failurePage('The sign-in response did not match this request.'));
      closeFlow(flow);
      return;
    }
    const error = url.searchParams.get('error');
    if (error !== null) {
      const description = url.searchParams.get('error_description') ?? error;
      page(response, 400, failurePage(description));
      closeFlow(flow);
      return;
    }
    const code = url.searchParams.get('code');
    if (code === null || code.length === 0) {
      page(response, 400, failurePage('The sign-in response did not include a code.'));
      closeFlow(flow);
      return;
    }
    try {
      const bundle = await exchangeCode(flow, code);
      await writeBundle(flow.serverId, bundle);
      needsAuth.delete(flow.serverId);
      closeFlow(flow);
      page(response, 200, successPage());
      deps.onUpdate?.(flow.serverId);
    } catch (error_) {
      closeFlow(flow);
      page(
        response,
        502,
        failurePage(error_ instanceof Error ? error_.message : 'The token exchange failed.'),
      );
    }
  }

  function startListener(flow: Omit<PendingFlow, 'listener' | 'timer' | 'redirectUri'>): Promise<{
    redirectUri: string;
    listener: Server;
  }> {
    const { promise, resolve, reject } = Promise.withResolvers<{
      redirectUri: string;
      listener: Server;
    }>();
    const listener = createServer((request, response) => {
      const current = pending.get(flow.serverId);
      if (current === undefined || current.flowId !== flow.flowId) {
        page(response, 404, failurePage('This sign-in request is no longer active.'));
        return;
      }
      const url = new URL(request.url ?? '/', current.redirectUri);
      if (request.method !== 'GET' || url.pathname !== OAUTH_CALLBACK_PATH) {
        page(response, 404, failurePage('Not found.'));
        return;
      }
      void handleCallback(current, url, response);
    });
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      listener.removeListener('error', reject);
      const address = listener.address();
      if (address === null || typeof address === 'string') {
        listener.close();
        reject(new Error('the OAuth callback listener did not bind a port'));
        return;
      }
      const port = (address as AddressInfo).port;
      resolve({ redirectUri: `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`, listener });
    });
    return promise;
  }

  async function refreshBundle(server: McpServer, bundle: OAuthTokenBundle): Promise<boolean> {
    if (bundle.refreshToken === undefined) {
      needsAuth.add(server.id);
      return false;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: bundle.refreshToken,
      client_id: bundle.clientId,
      resource: bundle.resource,
    });
    if (bundle.clientSecret !== undefined) body.set('client_secret', bundle.clientSecret);
    try {
      const response = await fetchFn(bundle.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        needsAuth.add(server.id);
        return false;
      }
      const parsed = await readJson(response, 'the token endpoint');
      const next = bundleFromTokenResponse(parsed, {
        clientId: bundle.clientId,
        ...(bundle.clientSecret === undefined ? {} : { clientSecret: bundle.clientSecret }),
        tokenEndpoint: bundle.tokenEndpoint,
        authorizationServer: bundle.authorizationServer,
        resource: bundle.resource,
        ...(bundle.scope === undefined ? {} : { scope: bundle.scope }),
        now: now(),
        previousRefreshToken: bundle.refreshToken,
      });
      await writeBundle(server.id, next);
      needsAuth.delete(server.id);
      deps.onUpdate?.(server.id);
      return true;
    } catch {
      needsAuth.add(server.id);
      return false;
    }
  }

  function refresh(server: McpServer): Promise<boolean> {
    const running = refreshing.get(server.id);
    if (running !== undefined) return running;
    const task = (async () => {
      try {
        const bundle = await readBundle(server);
        if (bundle === null) {
          needsAuth.add(server.id);
          return false;
        }
        return await refreshBundle(server, bundle);
      } finally {
        refreshing.delete(server.id);
      }
    })();
    refreshing.set(server.id, task);
    return task;
  }

  /** Current access token, refreshed when it is within the skew of expiry. */
  async function accessTokenFor(server: McpServer): Promise<string | null> {
    const bundle = await readBundle(server);
    if (bundle === null) return null;
    if (bundle.expiresAt - now() <= OAUTH_REFRESH_SKEW_MS && bundle.refreshToken !== undefined) {
      if (!(await refresh(server))) return null;
      return (await readBundle(server))?.accessToken ?? null;
    }
    return bundle.accessToken;
  }

  return {
    start: async (server, input = {}) => {
      if (server.transport !== 'http' || server.url === null) {
        throw badRequest('OAuth applies to http connectors only');
      }
      cancelPending(server.id);
      const challenge = await challengeOf(server);
      const resource = await discoverResourceMetadata(server.url, { fetchFn, challenge });
      const issuer = resource.authorizationServers[0];
      if (issuer === undefined) {
        throw new Error('the protected resource metadata names no authorization server');
      }
      const metadata = await discoverAuthorizationServer(issuer, fetchFn);

      const flowId = randomUUID();
      const pkce = createPkcePair();
      const state = base64url(randomBytes(16));
      const scope =
        resource.scopesSupported.length > 0
          ? resource.scopesSupported.join(' ')
          : metadata.scopesSupported.length > 0
            ? metadata.scopesSupported.join(' ')
            : undefined;

      const { redirectUri, listener } = await startListener({
        flowId,
        serverId: server.id,
        state,
        verifier: pkce.verifier,
        clientId: '',
        tokenEndpoint: metadata.tokenEndpoint,
        authorizationServer: metadata.issuer,
        resource: resource.resource || server.url,
        ...(scope === undefined ? {} : { scope }),
      });

      let clientId: string;
      let clientSecret: string | undefined;
      try {
        const stored = await readBundle(server);
        if (input.clientId !== undefined) {
          clientId = input.clientId;
          clientSecret = input.clientSecret;
        } else if (stored !== null) {
          clientId = stored.clientId;
          clientSecret = stored.clientSecret;
        } else {
          const registered = await registerOAuthClient(metadata, redirectUri, fetchFn);
          clientId = registered.clientId;
          clientSecret = registered.clientSecret;
        }
      } catch (error) {
        listener.close();
        throw error;
      }

      const authorize = new URL(metadata.authorizationEndpoint);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', pkce.challenge);
      authorize.searchParams.set('code_challenge_method', 'S256');
      authorize.searchParams.set('resource', resource.resource || server.url);
      if (scope !== undefined) authorize.searchParams.set('scope', scope);

      const timer = setTimeout(() => {
        const current = pending.get(server.id);
        if (current !== undefined && current.flowId === flowId) closeFlow(current);
      }, callbackTimeoutMs);
      timer.unref?.();

      pending.set(server.id, {
        flowId,
        serverId: server.id,
        state,
        verifier: pkce.verifier,
        redirectUri,
        clientId,
        ...(clientSecret === undefined ? {} : { clientSecret }),
        tokenEndpoint: metadata.tokenEndpoint,
        authorizationServer: metadata.issuer,
        resource: resource.resource || server.url,
        ...(scope === undefined ? {} : { scope }),
        listener,
        timer,
      });

      return { flowId, authorizeUrl: authorize.toString() };
    },

    status: async (server) => {
      const bundle = await readBundle(server);
      if (bundle === null) {
        return { connected: false, needsAuth: false, expiresAt: null, authorizationServer: null };
      }
      const expired = bundle.expiresAt <= now();
      const refreshable = bundle.refreshToken !== undefined;
      return {
        connected: !expired || refreshable,
        needsAuth: needsAuth.has(server.id) || (expired && !refreshable),
        expiresAt: new Date(bundle.expiresAt).toISOString(),
        authorizationServer: bundle.authorizationServer,
      };
    },

    disconnect: async (server) => {
      cancelPending(server.id);
      needsAuth.delete(server.id);
      await writeBundle(server.id, null);
      deps.onUpdate?.(server.id);
    },

    accessToken: accessTokenFor,

    headerValue: async (server) => {
      const token = await accessTokenFor(server);
      return token === null ? null : `Bearer ${token}`;
    },

    refresh,

    warm: async (server) => {
      if (server.authMode !== 'oauth') return;
      await readBundle(server);
    },

    cachedHeaderValue: (server) => {
      const bundle = bundles.get(server.id) ?? null;
      return bundle === null ? null : `Bearer ${bundle.accessToken}`;
    },

    dispose: () => {
      // Map iteration tolerates deleting the entry it just yielded.
      for (const flow of pending.values()) closeFlow(flow);
      bundles.clear();
      needsAuth.clear();
    },
  };
}
