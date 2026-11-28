import { chromium, devices } from '@playwright/test';

const base = 'http://127.0.0.1:4310';
const token = 'a91f9aaf818d1fd6c95d1ba9b69930101ac919ed3f1772883d589dc28683f5e8';

const created = await fetch(`${base}/pair/create`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, origin: base },
});
const body = await created.json();
console.log('pair link', body.url);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(body.url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
console.log('url after claim', page.url());
const status = await page.locator('[data-testid="connection-status"]').getAttribute('data-status').catch(() => null);
console.log('status', status);
console.log('cookies', (await context.cookies()).map((cookie) => cookie.name).join(','));
console.log('errors', errors.slice(0, 5));
await page.screenshot({ path: 'D:/tuffcode-mobile-pair.png' });
await browser.close();
