import { defineConfig } from '@playwright/test';

/**
 * Electron E2E: one worker because every test owns a real app instance, a temp
 * TUFFCODE_HOME, and a local mock provider. The suite never reaches the network.
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
