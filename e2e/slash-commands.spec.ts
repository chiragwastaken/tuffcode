import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  seedDefaultModel,
  setPermissionMode,
} from './helpers';

/** Types a command and runs it, dismissing the palette an exact name would open. */
async function runCommand(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Escape');
  await input.press('Enter');
}

test('runs slash commands from the composer', async ({ session, workspace, mock, rpc }) => {
  const { page } = session;

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);
  await createThreadThroughSidebar(page);
  await setPermissionMode(page, 'Full auto');

  const input = page.getByTestId('composer-input');
  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'slash';

  // The palette lists built-ins and shows the argument hint for commands with args.
  await input.fill('/sub');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await expect(palette).toContainText('/subagent');
  await expect(palette).toContainText('<type> <task>');
  await page.keyboard.press('Escape');
  await input.fill('');

  // /model opens the model picker instead of sending a message.
  await runCommand(page, '/model');
  await expect(page.getByTestId('model-picker-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('model-picker-popup')).toBeHidden();

  // /plan switches the thread mode through threads.update.
  await runCommand(page, '/plan');
  await expect(
    page.getByTestId('mode-select').getByRole('radio', { name: 'Plan' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('command-notice')).toContainText('Plan mode is on');

  // /subagent spawns a typed child and reports it in the composer.
  await runCommand(page, '/subagent explorer map the command palette');
  await expect(page.getByTestId('command-notice')).toContainText('Spawned explorer subagent');
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-subagent.png`) });
  }

  // /context opens the inspector's context tab with the prompt budget.
  await runCommand(page, '/context');
  await expect(page.getByTestId('context-panel')).toBeVisible();
  await expect(page.getByTestId('context-total')).toContainText('tokens');
  await expect(page.getByTestId('context-section').first()).toBeVisible();
  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-context.png`) });
  }

  // /help lists the commands with their hints.
  await runCommand(page, '/help');
  await expect(page.getByTestId('command-notice')).toContainText('/subagent <type> <task>');
  await expect(page.getByTestId('command-notice')).toContainText('Commands:');

  // /clear empties the transcript and reports what it removed.
  await runCommand(page, '/clear');
  await expect(page.getByTestId('command-notice')).toContainText('Cleared');

  // An unknown slash name falls through as a normal message.
  await input.fill('/nope keep this');
  await input.press('Escape');
  await input.press('Enter');
  await expect(
    page.getByTestId('user-message').filter({ hasText: '/nope keep this' }),
  ).toBeVisible();
  expect(mock.requests).toBeGreaterThan(0);
});
