import { chromium, devices } from '@playwright/test';

const loopback = 'http://127.0.0.1:4311';
const lan = 'http://192.168.0.102:4311';
const tail = 'http://100.118.244.56:4311';
const token = '185ac7a45477f49a97eb4fb73eae0b11c73a2ae084ad613da347ba74430c5da6';

async function createCode() {
  const response = await fetch(`${loopback}/pair/create`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: loopback },
  });
  if (!response.ok) throw new Error(`pair/create ${response.status} ${await response.text()}`);
  return (await response.json()).code;
}

const browser = await chromium.launch();
for (const [label, base] of [
  ['LAN', lan],
  ['Tailscale', tail],
]) {
  const code = await createCode();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${base}/pair?code=${code}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const status = await page
    .locator('[data-testid="connection-status"]')
    .getAttribute('data-status')
    .catch(() => null);
  console.log(label, 'url', page.url(), 'status', status, 'errors', errors.slice(0, 3));
  await page.screenshot({ path: `D:/tuffcode-mobile-${label.toLowerCase()}.png` });
  await context.close();
}
await browser.close();
