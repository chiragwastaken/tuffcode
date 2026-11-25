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
import { MOCK_SUBAGENT_FINAL, MOCK_SUBAGENT_TASK } from './mock-openai';

const ROOT_ROW_HEIGHT_PX = 48;
const ROW_HEIGHT_TOLERANCE_PX = 1;
const MIN_CHILD_INDENT_PX = 10;

test('nests the child thread under its root row and opens the subagent pane', async ({
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

  // The explorer runs a real child thread, which is the only way a thread gets a
  // parent outside the council runner.
  await sendMessage(page, 'spawn-subagent');
  await expectAssistantText(page, MOCK_SUBAGENT_FINAL);

  const rootRow = page.getByTestId('thread-row');
  const childRow = page.getByTestId('thread-child-row');
  await expect(rootRow).toHaveCount(1);
  await expect(childRow).toHaveCount(1);
  await expect(childRow).toBeVisible();
  await expect(childRow).toContainText('Explorer');

  // D38: the root row is 48px, and the child sits directly under it, not beside it.
  const rootBox = await rootRow.boundingBox();
  const childBox = await childRow.boundingBox();
  if (rootBox === null || childBox === null) throw new Error('a sidebar row has no box');
  expect(rootBox.height).toBeGreaterThanOrEqual(ROOT_ROW_HEIGHT_PX - ROW_HEIGHT_TOLERANCE_PX);
  expect(rootBox.height).toBeLessThanOrEqual(ROOT_ROW_HEIGHT_PX + ROW_HEIGHT_TOLERANCE_PX);
  expect(childBox.y).toBeGreaterThanOrEqual(rootBox.y + rootBox.height);

  const rootLabel = await rootRow.locator('span').first().boundingBox();
  const childLabel = await childRow.locator('span').first().boundingBox();
  if (rootLabel === null || childLabel === null) throw new Error('a sidebar label has no box');
  expect(childLabel.x).toBeGreaterThan(rootLabel.x + MIN_CHILD_INDENT_PX);

  const parentId = await rootRow.getAttribute('data-thread-id');
  const childId = await childRow.getAttribute('data-thread-id');
  if (parentId === null || childId === null) throw new Error('a sidebar row has no thread id');

  // The child row maps to its subagent through childThreadId, which arrives with
  // the debounced subagents.list refresh (250ms after the settle frame). The
  // Activity row's title is that task, so waiting for it proves the merge landed
  // before the click is expected to open the pane.
  await page.getByTestId('activity-button').click();
  const activityChild = page.getByTestId('activity-subagent-row');
  await expect(activityChild).toHaveCount(1);
  await expect(activityChild).toHaveAttribute('title', MOCK_SUBAGENT_TASK);

  // Clicking the child opens its pane without moving the route off the parent.
  await childRow.click();
  const pane = page.getByTestId('subagent-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('subagent-pane-header')).toContainText('Explorer');
  expect(page.url()).toContain('/thread/' + parentId);
  expect(page.url()).not.toContain(childId);
});
