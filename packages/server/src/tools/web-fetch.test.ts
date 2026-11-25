import { describe, expect, it } from 'vitest';
import { assertPublicHost, createWebFetch, htmlToText, isPrivateAddress, validateFetchUrl } from './web-fetch.js';

/** Every name resolves to a public documentation address unless a test says otherwise. */
const publicDns = async (): Promise<string[]> => ['93.184.215.14'];

function response(body: string, init: { status?: number; type?: string; location?: string } = {}): Response {
  const headers = new Headers();
  if (init.type !== undefined) headers.set('content-type', init.type);
  if (init.location !== undefined) headers.set('location', init.location);
  return new Response(body, { status: init.status ?? 200, headers });
}

describe('web_fetch', () => {
  it('refuses non-http schemes, credentials and private hosts', () => {
    expect(() => validateFetchUrl('file:///C:/secrets.txt')).toThrow(/http and https/);
    expect(() => validateFetchUrl('ftp://example.com')).toThrow(/http and https/);
    expect(() => validateFetchUrl('https://user:pw@example.com')).toThrow(/credentials/);
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.2', '172.20.0.1', '[::1]', 'printer.local']) {
      expect(() => validateFetchUrl(`http://${host}/`)).toThrow(/private/);
    }
    expect(validateFetchUrl('https://docs.example.com/a').hostname).toBe('docs.example.com');
  });

  it('turns HTML into readable text', () => {
    expect(
      htmlToText('<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>One &amp; two</p><p>Three&nbsp;four</p></body></html>'),
    ).toBe('Title\nOne & two\nThree four');
  });

  it('follows redirects through the host check and caps the text', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => {
      calls.push(url);
      if (url.endsWith('/old')) return response('', { status: 301, location: '/new' });
      return response(`<p>${'word '.repeat(400)}</p>`, { type: 'text/html; charset=utf-8' });
    };
    const text = await createWebFetch(fetchFn, publicDns)('https://example.com/old', 600);
    expect(calls).toEqual(['https://example.com/old', 'https://example.com/new']);
    expect(text.startsWith('URL: https://example.com/new')).toBe(true);
    expect(text.endsWith('[truncated]')).toBe(true);
  });

  it('refuses a redirect into the private network and binary bodies', async () => {
    const intoLan = async (): Promise<Response> => response('', { status: 302, location: 'http://192.168.0.1/admin' });
    await expect(createWebFetch(intoLan, publicDns)('https://example.com/', 1000)).rejects.toThrow(/private/);
    const image = async (): Promise<Response> => response('PNG', { type: 'image/png' });
    await expect(createWebFetch(image, publicDns)('https://example.com/a.png', 1000)).rejects.toThrow(/image\/png/);
    const missing = async (): Promise<Response> => response('nope', { status: 404, type: 'text/plain' });
    await expect(createWebFetch(missing, publicDns)('https://example.com/x', 1000)).rejects.toThrow(/404/);
  });

  it('refuses a public name that resolves into the private network, at the first hop and after redirects', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => {
      calls.push(url);
      return response('', { status: 302, location: 'https://rebind.example.net/' });
    };
    const dns = async (host: string): Promise<string[]> =>
      host === 'rebind.example.net' ? ['93.184.215.14', '::ffff:10.0.0.7'] : ['93.184.215.14'];
    await expect(createWebFetch(fetchFn, dns)('https://start.example.com/', 1000)).rejects.toThrow(/resolves to a private/);
    expect(calls).toEqual(['https://start.example.com/']);
    await expect(assertPublicHost(new URL('https://lan.example.com/'), async () => ['192.168.1.10'])).rejects.toThrow(/private/);
    await expect(assertPublicHost(new URL('https://gone.example.com/'), async () => [])).rejects.toThrow(/could not resolve/);
  });

  it('classifies private, mapped, CGNAT and reserved addresses', () => {
    for (const address of ['10.1.2.3', '100.64.0.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '::', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '100.128.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
