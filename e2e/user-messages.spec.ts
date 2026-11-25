import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
} from './helpers';
import { MOCK_TEXT } from './mock-openai';

test('a reopened thread shows the persisted user message', async ({
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

  await sendMessage(page, 'Persist this user turn');
  await expectAssistantText(page, MOCK_TEXT);
  await expect(
    page.getByTestId('user-message').filter({ hasText: 'Persist this user turn' }),
  ).toBeVisible();

  // Reloading drops the session-local echo; the bubble now comes from messages.list.
  await page.reload();
  // The first message names the thread (round 4 titles).
  await expect(page.getByTestId('thread-title')).toHaveText('Persist this user turn');
  const bubble = page.getByTestId('user-message').filter({ hasText: 'Persist this user turn' });
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute('data-status', 'sent');
  await expectAssistantText(page, MOCK_TEXT);
});
