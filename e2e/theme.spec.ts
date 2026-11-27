import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openSettingsSection } from './helpers';

/** Reads a palette token from the document element. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (tokenName) =>
      getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim(),
    name,
  );
}

/** Opens Appearance unless a reload restored that route already. */
async function ensureAppearance(page: Page): Promise<void> {
  if ((await page.getByTestId('theme-picker').count()) > 0) return;
  await openSettingsSection(page, 'Appearance');
  await expect(page.getByTestId('theme-picker')).toBeVisible();
}

test('applies a named palette on click and keeps it after a relaunch', async ({ session }) => {
  const { page } = session;

  await ensureAppearance(page);
  const picker = page.getByTestId('theme-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(15);

  // One click applies and saves: no separate Save step for the theme.
  await page.getByTestId('theme-nord').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord');
  await expect(page.getByTestId('theme-nord')).toHaveAttribute('aria-checked', 'true');
  expect(await token(page, '--background')).toBe('#2e3440');

  // Code blocks and the terminal follow the same palette through Shiki/xterm.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord');
  await ensureAppearance(page);
  await expect(page.getByTestId('theme-nord')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await token(page, '--background')).toBe('#ffffff');

  await session.relaunch();
  const relaunched = session.page;
  await expect(relaunched.getByTestId('app-shell')).toBeVisible();
  await expect(relaunched.locator('html')).toHaveAttribute('data-theme', 'light');
  await ensureAppearance(relaunched);
  await expect(relaunched.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true');
});
