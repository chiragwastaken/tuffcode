import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  openSettingsSection,
  seedDefaultModel,
  sendMessage,
} from './helpers';
import { MOCK_TEXT } from './mock-openai';

test('thread history survives a restart', async ({ session, workspace, mock, rpc }) => {
  const { page } = session;

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);
  const title = await createThreadThroughSidebar(page);

  await sendMessage(page, 'Say hello before the restart');
  await expectAssistantText(page, MOCK_TEXT);

  await session.relaunch();
  await expect(session.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'open',
  );

  const row = session.page.getByTestId('thread-row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.click();
  await expect(session.page.getByTestId('thread-title')).toHaveText(title);
  await expectAssistantText(session.page, MOCK_TEXT);
});

test('settings persist across a restart', async ({ session }) => {
  const { page } = session;

  await openSettingsSection(page, 'General');
  await page.getByTestId('settings-shell').fill('pwsh.exe');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await session.relaunch();
  await openSettingsSection(session.page, 'General');
  await expect(session.page.getByTestId('settings-shell')).toHaveValue('pwsh.exe');
});
