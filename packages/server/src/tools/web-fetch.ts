import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * The `web_fetch` tool: one GET of an http(s) URL the model names, reduced to readable
 * text. It is the agent's own request on the user's task, gated like bash (approval in
 * ask mode), bounded in time and size, and refuses private network targets so a
 * prompt-injected page cannot pivot into the LAN.
 */
export const WEB_FETCH_TIMEOUT_MS = 15_000;
export const WEB_FETCH_BYTE_LIMIT = 2 * 1024 * 1024;

export type WebFetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Unspecified, private, loopback, link-local, CGNAT, IETF, benchmark and multicast or reserved ranges. */
const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^198\.1[89]\./,
  /^(22[4-9]|2[3-5]\d)\./,
];

/** True for any address a fetch must not reach; IPv4-mapped IPv6 is unwrapped first. */
export function isPrivateAddress(address: string): boolean {
  let host = address.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped?.[1] !== undefined) host = mapped[1];
  if (isIP(host) === 4) return PRIVATE_V4.some((pattern) => pattern.test(host));
  if (isIP(host) === 6) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('::ffff:') ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('ff')
    );
  }
  return false;
}

function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isPrivateAddress(host);
}

export type HostLookup = (hostname: string) => Promise<string[]>;

const systemLookup: HostLookup = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Resolves the host and refuses it when any address is private, so a public name that
 * points into the LAN is caught. Runs before the first request and before every redirect.
 * A resolver that changes its answer between this check and the connect (DNS rebinding)
 * is not covered: Node's fetch exposes no connect-time lookup hook without undici.
 */
export async function assertPublicHost(url: URL, resolve: HostLookup = systemLookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch (error) {
    throw new Error(`could not resolve ${host}`, { cause: error });
  }
  if (addresses.length === 0) throw new Error(`could not resolve ${host}`);
  if (addresses.some(isPrivateAddress)) {
    throw new Error('the host resolves to a private or local network address');
  }
}

export function validateFetchUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('url must be an absolute http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http and https URLs can be fetched');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('URLs with embedded credentials are refused');
  }
  if (privateHost(url.hostname)) throw new Error('private and local network hosts are refused');
  return url;
}

const BLOCK_TAGS = /<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote|header|footer|table)>|<br\s*\/?>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** HTML to plain text: scripts, styles and tags removed, block ends become newlines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readLimited(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > WEB_FETCH_BYTE_LIMIT) {
      await reader.cancel().catch(() => undefined);
      return { text: text + decoder.decode(), truncated: true };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

export function createWebFetch(
  fetchFn: WebFetchFn = (input, init) => fetch(input, init),
  resolve: HostLookup = systemLookup,
) {
  return async (raw: string, maxChars: number): Promise<string> => {
    const url = validateFetchUrl(raw);
    await assertPublicHost(url, resolve);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    timer.unref?.();
    try {
      // Redirects are followed by hand so every hop passes the same host check.
      let current = url;
      let response: Response | null = null;
      for (let hop = 0; hop < 5; hop += 1) {
        response = await fetchFn(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: { accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.5', 'user-agent': 'Tuffcode web_fetch' },
          signal: controller.signal,
        });
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || location === null) break;
        current = validateFetchUrl(new URL(location, current).toString());
        await assertPublicHost(current, resolve);
        response = null;
      }
      if (response === null) throw new Error('too many redirects');
      if (!response.ok) throw new Error(`the server answered with status ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!/text|json|xml|javascript/i.test(type) && type.length > 0) {
        throw new Error(`refusing to read a ${type.split(';')[0]} response as text`);
      }
      const { text, truncated } = await readLimited(response);
      const readable = /html/i.test(type) ? htmlToText(text) : text.trim();
      const cut = readable.length > maxChars;
      const body = cut ? readable.slice(0, maxChars) : readable;
      const notes = [cut || truncated ? '[truncated]' : ''].filter((note) => note.length > 0);
      return [`URL: ${current.toString()}`, '', body, ...notes].join('\n');
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`fetch timed out after ${WEB_FETCH_TIMEOUT_MS} ms`, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
