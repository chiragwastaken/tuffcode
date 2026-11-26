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
import { MOCK_ACTIVITY_COMMAND, MOCK_ACTIVITY_FINAL } from './mock-openai';

test('lists the running bash call in Activity and keeps its output once finished', async ({
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

  // Ask mode holds the call open at the approval gate, so the Running row is a
  // stable state rather than a frame that can pass between polls.
  await setPermissionMode(page, 'Ask');
  await page.getByTestId('activity-button').click();
  const panel = page.getByTestId('activity-panel');
  await expect(panel).toBeVisible();

  await sendMessage(page, 'activity-bash');
  await expect(page.getByTestId('approval-card').last()).toBeVisible();

  const running = page.getByTestId('activity-running-tool');
  await expect(running).toHaveCount(1);
  await expect(running.first()).toContainText('node -e');
  await expect(running.first()).toContainText('activity-ok');

  await page.getByTestId('approval-allow').last().click();
  await expectAssistantText(page, MOCK_ACTIVITY_FINAL);

  // The call moves from Running to Finished and keeps its output tail there.
  await expect(running).toHaveCount(0);
  const finished = page.getByTestId('activity-finished-tool');
  await expect(finished).toHaveCount(1);
  await expect(finished.first()).toContainText('node -e');
  await finished.first().click();
  await expect(finished.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('pre')).toContainText('activity-ok');
  await expect(page.getByTestId('activity-waiting-empty')).toBeVisible();

  // The thread timeline keeps the same completed call as a secondary surface,
  // folded under the finished turn's steps row.
  const completedSteps = page.getByTestId('steps-block').last();
  await completedSteps.getByRole('button').first().click();
  const completed = completedSteps.getByTestId('tool-row').last();
  await expect(completed).toHaveAttribute('data-status', 'done');
  await expect(completed).toContainText(MOCK_ACTIVITY_COMMAND);
  await completed.getByRole('button').click();
  await expect(completedSteps.getByTestId('tool-output').last()).toContainText('activity-ok');
});
