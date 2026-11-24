import { expect, test } from './fixtures';

test('app boots with a window title and no console errors', async ({ session }) => {
  const { page, app } = session;

  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'open');

  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          return window === undefined ? '' : window.getTitle();
        }),
      { timeout: 30_000 },
    )
    .toBe('Tuffcode');
  expect(await page.title()).toBe('Tuffcode');

  expect(session.pageErrors).toEqual([]);
  expect(session.consoleErrors).toEqual([]);
});
