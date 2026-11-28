import { chromium, devices } from '@playwright/test';

const base = 'http://127.0.0.1:4310';
const token = 'a91f9aaf818d1fd6c95d1ba9b69930101ac919ed3f1772883d589dc28683f5e8';
const origin = base;

async function pair() {
  const created = await fetch(`${base}/pair/create`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin },
  });
  if (!created.ok) throw new Error(`pair/create ${created.status} ${await created.text()}`);
  const body = await created.json();
  const claimed = await fetch(`${base}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ code: body.code, deviceName: 'Smoke phone' }),
  });
  if (!claimed.ok) throw new Error(`pair/claim ${claimed.status} ${await claimed.text()}`);
  const cookie = claimed.headers.get('set-cookie')?.split(';')[0] ?? '';
  const value = cookie.slice(cookie.indexOf('=') + 1);
  return { code: body.code, value };
}

const anonymous = await fetch(`${base}/bootstrap`);
console.log('bootstrap anonymous', anonymous.status);
const paired = await pair();
console.log('paired cookie', paired.value.slice(0, 8) + '...');

const withCookie = await fetch(`${base}/bootstrap`, { headers: { cookie: `tuffcode_session=${paired.value}` } });
console.log('bootstrap paired', withCookie.status, (await withCookie.text()).slice(0, 120));

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
await context.addCookies([
  { name: 'tuffcode_session', value: paired.value, domain: '127.0.0.1', path: '/' },
]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const status = await page.locator('[data-testid="connection-status"]').getAttribute('data-status').catch(() => null);
const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
console.log('page status', status);
console.log('body', bodyText.replace(/\n+/g, ' | '));
console.log('errors', errors.slice(0, 5));
await page.screenshot({ path: 'D:/tuffcode-mobile-probe.png', fullPage: false });
await browser.close();
