import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Playwright webServer for the mobile project. It serves the built web app with
 * remote access on loopback, writes the one-time test token to the temp directory,
 * and keeps running until Playwright stops it.
 */
const root = resolve(import.meta.dirname, '..');
const webRoot = join(root, 'apps', 'web', 'dist');
const serverEntry = join(root, 'packages', 'server', 'dist', 'server.js');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (!existsSync(serverEntry)) {
  execFileSync(pnpm, ['build:server'], { cwd: root, stdio: 'inherit' });
}
if (!existsSync(join(webRoot, 'index.html'))) {
  execFileSync(pnpm, ['--filter', '@tuffcode/web', 'build'], { cwd: root, stdio: 'inherit' });
}

const home = mkdtempSync(join(tmpdir(), 'tuffcode-mobile-e2e-'));
process.env.TUFFCODE_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;

const { startServer } = await import(pathToFileURL(serverEntry).href);
const running = await startServer({
  version: '0.0.0-e2e',
  dbFile: join(home, 'tuffcode.db'),
  writeServerJson: false,
  remoteOverrides: {
    enabled: true,
    bindHost: '127.0.0.1',
    port: 4310,
    publicUrl: '',
    allowedOrigins: [],
  },
  webRoot,
});

writeFileSync(join(tmpdir(), 'tuffcode-mobile-e2e-token'), running.token, 'utf8');
console.log(`MOBILE_READY ${running.port}`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await running.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
