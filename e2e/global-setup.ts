import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Builds the two artifacts the suite launches: the bundled server and the Electron
 * main/preload/renderer output. Set TUFFCODE_E2E_SKIP_BUILD=1 to reuse a warm build.
 */
export default function globalSetup(): void {
  if (process.env['TUFFCODE_E2E_SKIP_BUILD'] === '1') return;
  const root = fileURLToPath(new URL('..', import.meta.url));
  execSync('pnpm build:server', { cwd: root, stdio: 'inherit' });
  execSync('pnpm --filter @tuffcode/desktop build', { cwd: root, stdio: 'inherit' });
}
