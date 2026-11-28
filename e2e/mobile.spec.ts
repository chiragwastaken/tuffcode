import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Mobile shell smoke: the served build, its manifest, and the service worker contract.
 *
 * URL contract: the mobile server (`packages/server/src/http.ts`) serves `apps/web/dist`
 * on `remote.port`, 4310 by default, and a phone opens `http://<bindHost>:4310`.
 * `TUFFCODE_MOBILE_URL` overrides that base URL, which is how a LAN or Tailscale address
 * is tested. Nothing here launches Electron, so when no served build answers, every test
 * skips and names the probe failure instead of failing on a missing server.
 */
const BASE_URL = process.env['TUFFCODE_MOBILE_URL'] ?? 'http://127.0.0.1:4310';
const PROBE_TIMEOUT_MS = 5_000;
const WORKER_TIMEOUT_MS = 15_000;

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface ManifestJson {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
}

let unreachable: string | null = null;

function servedUrl(path: string): string {
  return new URL(path, BASE_URL).toString();
}

async function readManifest(): Promise<ManifestJson> {
  const response = await fetch(servedUrl('/manifest.webmanifest'));
  expect(response.ok, 'the served build must include manifest.webmanifest').toBe(true);
  const contentType = response.headers.get('content-type') ?? '';
  expect(contentType, 'a manifest must be served with a JSON media type').toContain('json');
  return (await response.json()) as ManifestJson;
}

/**
 * Registers the served worker and waits until it controls the page.
 *
 * The call site in `main.tsx` belongs to another branch, so this spec drives the
 * `/sw.js` asset directly. `registerPwa` and its secure-context rules are covered by
 * apps/web/src/pwa.test.ts.
 */
async function activateWorker(page: Page): Promise<void> {
  const outcome = await page.evaluate(async (timeoutMs: number) => {
    if (!('serviceWorker' in navigator)) return 'this browser has no service worker support';
    const late = Promise.withResolvers<string>();
    const timer = setTimeout(
      () => late.resolve(`no service worker became active within ${timeoutMs} ms`),
      timeoutMs,
    );
    const outcome = await Promise.race([
      (async () => {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.scriptURL ?? 'the registration has no active worker';
      })(),
      late.promise,
    ]);
    clearTimeout(timer);
    return outcome;
  }, WORKER_TIMEOUT_MS);

  expect(outcome, 'the served build must include /sw.js').toContain('/sw.js');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: WORKER_TIMEOUT_MS,
  });
}

test.beforeAll(async () => {
  try {
    const response = await fetch(servedUrl('/'), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) unreachable = `${servedUrl('/')} answered HTTP ${response.status}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    unreachable = `${servedUrl('/')} did not answer (${reason})`;
  }
});

test.beforeEach(() => {
  if (unreachable !== null) {
    throw new Error(
      `${unreachable}. The Playwright webServer should have started the mobile server; ` +
        'check scripts/mobile-test-server.mjs.',
    );
  }
});

test('serves the shell with a linked, valid manifest', async ({ page }) => {
  await page.goto(servedUrl('/'), { waitUntil: 'domcontentloaded' });

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  if (!href) {
    throw new Error(
      'index.html must link the manifest: ' +
        '<link rel="manifest" href="/manifest.webmanifest" type="application/manifest+json">',
    );
  }
  const linked = await fetch(new URL(href, page.url()).toString());
  expect(linked.ok, `the linked manifest ${href} must load`).toBe(true);

  const manifest = await readManifest();
  expect(manifest.name).toBe('Tuffcode');
  expect(manifest.short_name).toBe('Tuffcode');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color, 'the manifest needs a theme color').toBeTruthy();
  expect(manifest.background_color, 'the manifest needs a background color').toBeTruthy();

  const icons = manifest.icons ?? [];
  const sizes = icons.map((icon) => icon.sizes);
  expect(sizes, 'installability needs a 192px and a 512px icon').toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  for (const icon of icons) expect(icon.type).toBe('image/png');
});

test('pairs a phone and opens the workspace over the session cookie', async ({ page, context }) => {
  const token = readFileSync(join(tmpdir(), 'tuffcode-mobile-e2e-token'), 'utf8').trim();
  const created = await fetch(servedUrl('/pair/create'), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: BASE_URL },
  });
  expect(created.ok, 'the test server must create a pairing code').toBe(true);
  const { code } = (await created.json()) as { code: string };

  const claimed = await fetch(servedUrl('/pair/claim'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ code, deviceName: 'Playwright phone' }),
  });
  expect(claimed.ok, 'the phone must claim the code').toBe(true);
  const setCookie = claimed.headers.get('set-cookie') ?? '';
  const value = /tuffcode_session=([0-9a-f]{64})/.exec(setCookie)?.[1];
  expect(value, 'the claim must set the session cookie').toBeTruthy();

  await context.addCookies([
    { name: 'tuffcode_session', value: value ?? '', domain: new URL(BASE_URL).hostname, path: '/' },
  ]);
  await page.goto(servedUrl('/'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute(
    'data-status',
    'open',
    { timeout: 20_000 },
  );
  await expect(page.getByText('Workspace', { exact: false }).first()).toBeVisible();
});

test('serves each declared icon at its declared size', async () => {
  const manifest = await readManifest();
  const icons = manifest.icons ?? [];
  expect(icons.length).toBeGreaterThanOrEqual(2);

  for (const icon of icons) {
    const response = await fetch(servedUrl(icon.src));
    expect(response.ok, `${icon.src} must be served`).toBe(true);
    expect(response.headers.get('content-type') ?? '').toContain('image/png');

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    // A PNG IHDR stores width and height as big-endian uint32 at byte offsets 16 and 20.
    const size = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
    expect(size, `${icon.src} does not match its declared size`).toBe(icon.sizes);
  }
});

test('caches the shell and keeps server surfaces out of Cache Storage', async ({ page }) => {
  await page.goto(servedUrl('/'), { waitUntil: 'domcontentloaded' });
  await activateWorker(page);

  // Touch the surfaces the worker must ignore, then list every cached URL.
  await page.evaluate(async () => {
    await Promise.all([
      fetch('/bootstrap', { cache: 'no-store' }).catch(() => undefined),
      fetch('/health', { cache: 'no-store' }).catch(() => undefined),
    ]);
  });

  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });

  expect(cachedPaths, 'the shell must be cached').toContain('/');
  expect(cachedPaths, 'the manifest must be cached').toContain('/manifest.webmanifest');
  expect(
    cachedPaths.filter((path) => /^\/(ws|bootstrap|pair|health)(\/|$)/.test(path)),
    'server surfaces must never enter Cache Storage',
  ).toEqual([]);
});

test('serves the cached shell after the network drops', async ({ page, context }) => {
  await page.goto(servedUrl('/'), { waitUntil: 'domcontentloaded' });
  await activateWorker(page);

  await context.setOffline(true);
  const response = await page.reload({ waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'the worker must answer the navigation from its cache').toBe(200);
  await expect(page.locator('#root')).toHaveCount(1);
});
