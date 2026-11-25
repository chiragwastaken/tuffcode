import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
  setPermissionMode,
  openDock,
} from './helpers';
import { MOCK_FILE_PATH, MOCK_TEXT, MOCK_WROTE_TEXT } from './mock-openai';

test('thread and message menus rename, retry and delete', async ({
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

  await sendMessage(page, 'Say hello to the menu suite');
  await expect(
    page.getByTestId('user-message').filter({ hasText: 'Say hello to the menu suite' }),
  ).toBeVisible();
  await expectAssistantText(page, MOCK_TEXT);

  const row = page.getByTestId('thread-row').first();
  const menu = page.getByTestId('context-menu');

  // Right-click opens the thread menu with the four documented rows.
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(4);
  await expect(menu).toContainText('Rename');
  await expect(menu).toContainText('Copy path');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Shift+F10 opens the same menu for the focused row.
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Rename through the menu updates the sidebar row.
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  const renameDialog = page.getByRole('dialog');
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel('Thread title').fill('Renamed by menu');
  await renameDialog.getByRole('button', { name: 'Save' }).click();
  await expect(renameDialog).toBeHidden();
  await expect(row).toContainText('Renamed by menu');

  // Hovering a message reveals its icon actions without moving the bubble.
  const userRow = page.getByTestId('user-message-row').first();
  await userRow.hover();
  await expect(page.getByTestId('message-actions').first()).toBeVisible();
  await expect(page.getByTestId('message-actions').first()).toHaveCSS('opacity', '1');
  await expect(userRow.getByTestId('message-action-message.copy')).toBeVisible();

  // The assistant menu offers copy, copy as markdown and retry.
  await page.getByTestId('assistant-message-row').first().click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  await expect(menu).toContainText('Copy as markdown');
  await expect(menu).toContainText('Retry');
  await page.keyboard.press('Escape');

  // Delete asks for confirmation, then the row disappears.
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete thread' }).click();
  const deleteDialog = page.getByRole('dialog');
  await expect(deleteDialog).toContainText('Delete Renamed by menu?');
  await deleteDialog.getByRole('button', { name: 'Delete thread' }).click();
  await expect(page.getByTestId('thread-row')).toHaveCount(0);
});

test('diff file menu offers copy path and open in terminal', async ({
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

  await openDock(page, 'diff');
  const panel = page.getByTestId('diff-panel');
  await panel.getByRole('button', { name: 'Refresh diff' }).click();
  const file = panel.getByTestId('diff-file').filter({ hasText: MOCK_FILE_PATH });
  await expect(file).toBeVisible();

  await file.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu).toContainText('Copy path');
  await expect(menu).toContainText('Open in terminal');

  const openItem = menu.getByRole('menuitem', { name: 'Open in terminal' });
  await expect(openItem).toBeEnabled();
  await openItem.click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('inspector-tab-terminal')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('terminal-panel')).toBeVisible();
});
