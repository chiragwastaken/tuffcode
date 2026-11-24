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
  await expect(
    session.page.getByTestId('user-message').filter({ hasText: 'Say hello before the restart' }),
  ).toBeVisible();
  await expectAssistantText(session.page, MOCK_TEXT);
});

test('settings persist across a restart', async ({ session }) => {
  const { page } = session;

  await openSettingsSection(page, 'Appearance');
  const toggle = page.getByLabel('Animate panels');
  const before = await toggle.isChecked();
  if (before) await toggle.uncheck();
  else await toggle.check();

  // The save bar only exists while the draft is dirty.
  await expect(page.getByText('Unsaved changes.')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(page.getByText('Unsaved changes.')).toBeHidden();

  await session.relaunch();
  await openSettingsSection(session.page, 'Appearance');
  await expect(session.page.getByLabel('Animate panels')).toBeChecked({ checked: !before });
});

test('a collapsed project stays collapsed across a restart', async ({
  session,
  workspace,
  mock,
  rpc,
}) => {
  const { page } = session;

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);
  const title = await createThreadThroughSidebar(page);

  const row = page.getByTestId('thread-row').filter({ hasText: title });
  await expect(row).toBeVisible();

  const toggle = page.getByTestId('project-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toBeHidden();

  await session.relaunch();
  await expect(session.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'open',
  );

  const reloaded = session.page.getByTestId('project-toggle');
  await expect(reloaded).toHaveAttribute('aria-expanded', 'false');
  await expect(session.page.getByTestId('thread-row')).toHaveCount(0);

  await reloaded.click();
  await expect(session.page.getByTestId('thread-row').filter({ hasText: title })).toBeVisible();
});
