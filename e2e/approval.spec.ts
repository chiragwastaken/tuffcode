import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
} from './helpers';
import { MOCK_ALLOWED_TEXT, MOCK_DENIED_TEXT } from './mock-openai';

test('denies a bash approval, keeps the thread alive, then allows one', async ({
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

  await sendMessage(page, 'run-bash now');
  const firstCard = page.getByTestId('approval-card');
  await expect(firstCard).toBeVisible();
  await expect(page.getByTestId('thread-status')).toHaveAttribute('data-status', 'needs-approval');

  await page.getByTestId('approval-deny').click();
  await expect(firstCard).toContainText('Denied');
  await expectAssistantText(page, MOCK_DENIED_TEXT);
  await expect(page.getByTestId('thread-status')).toHaveAttribute('data-status', 'ready-to-review');

  const deniedSteps = page.getByTestId('steps-block').last();
  await deniedSteps.getByRole('button').first().click();
  const deniedTool = deniedSteps.getByTestId('tool-row').last();
  await deniedTool.getByRole('button').click();
  await expect(page.getByTestId('tool-output').last()).toContainText('denied by user');

  await sendMessage(page, 'run-bash again');
  await expect(page.getByTestId('approval-card').last()).toBeVisible();
  await page.getByTestId('approval-allow').last().click();
  await expectAssistantText(page, MOCK_ALLOWED_TEXT);
  await expect(page.getByTestId('thread-status')).toHaveAttribute('data-status', 'ready-to-review');

  const allowedSteps = page.getByTestId('steps-block').last();
  await allowedSteps.getByRole('button').first().click();
  const allowedTool = allowedSteps.getByTestId('tool-row').last();
  await allowedTool.getByRole('button').click();
  await expect(page.getByTestId('tool-output').last()).toContainText('tuffcode-ok');
});
