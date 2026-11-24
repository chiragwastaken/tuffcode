import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
  setPermissionMode,
} from './helpers';
import { MOCK_FILE_PATH, MOCK_WROTE_TEXT } from './mock-openai';

test('diff panel shows the file the mock provider wrote', async ({
  session,
  workspace,
  mock,
  rpc,
}) => {
  const { page } = session;

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);
  await createThreadThroughSidebar(page);

  await setPermissionMode(page, 'Full auto');
  await sendMessage(page, 'write-file now');
  await expectAssistantText(page, MOCK_WROTE_TEXT);

  await expect(page.getByTestId('inspector-tab-diff')).toBeVisible();
  await page.getByTestId('inspector-tab-diff').click();
  const panel = page.getByTestId('diff-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh diff' }).click();
  const added = panel.getByTestId('diff-file').filter({ hasText: MOCK_FILE_PATH });
  await expect(added).toBeVisible();
  await added.click();
  await expect(panel).toContainText(MOCK_FILE_PATH);
});
