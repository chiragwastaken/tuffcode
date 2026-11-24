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

test('adds a project, points a provider at the mock, and streams a reply', async ({
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
  expect(title.length).toBeGreaterThan(0);

  await sendMessage(page, 'Say hello to the e2e suite');
  await expectAssistantText(page, MOCK_TEXT);
  await expect(page.getByTestId('thread-status')).toHaveAttribute('data-status', 'ready-to-review');
  expect(mock.requests).toBeGreaterThan(0);
});
