import { expect, test } from './fixtures';
import { openSettingsSection } from './helpers';

test('provider gallery shows subscriptions and Claude needs no API key', async ({ session }) => {
  const { page } = session;

  await openSettingsSection(page, 'Providers');
  await page.getByRole('button', { name: 'Add provider' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const subscriptions = dialog.getByTestId('provider-group-subscriptions');
  await expect(subscriptions).toBeVisible();
  await expect(subscriptions.getByTestId('provider-preset-claude')).toContainText('Claude');
  await expect(subscriptions.getByTestId('provider-preset-chatgpt')).toContainText('ChatGPT');

  await subscriptions.getByTestId('provider-preset-claude').click();
  await expect(dialog).toContainText('Add Claude');
  await expect(dialog.getByRole('button', { name: /^Sign in/ })).toHaveCount(1);
  await expect(dialog.locator('#provider-secret')).toHaveCount(0);
  await expect(dialog.getByTestId('provider-secret-input')).toHaveCount(0);
});
