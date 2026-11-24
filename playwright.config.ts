import { defineConfig } from '@playwright/test';

/**
 * Electron E2E: one worker because every test owns a real app instance, a temp
 * home/userData, and a local mock provider. The suite never reaches the network.
 * Each workspace is deleted on teardown, and TUFFCODE_USER_DATA gives every run its
 * own Electron single-instance lock, so two suites can run concurrently in separate
 * worktrees without either app instance quitting.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
