import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  seedDefaultModel,
  sendMessage,
} from './helpers';

function threadIdOf(row: Locator): Promise<string> {
  return row.getAttribute('data-thread-id').then((id) => {
    if (id === null) throw new Error('a thread row has no data-thread-id');
    return id;
  });
}

function inboxRow(page: Page, threadId: string): Locator {
  return page.locator(`[data-testid="inbox-row"][data-thread-id="${threadId}"]`);
}

/**
 * The cross-project answer to "which agent is blocked on me": two threads from the
 * same project listed with their project name, one put at the approval gate by the
 * mock provider, the badge counting it, Allow resolving it in place, and a row
 * opening its thread.
 */
test('lists threads across projects and resolves an approval from Needs you', async ({
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
  const firstId = await threadIdOf(page.locator('[data-testid="thread-row"][aria-current="page"]'));

  await createThreadThroughSidebar(page);
  await expect(page.getByTestId('thread-row')).toHaveCount(2);
  const secondId = await threadIdOf(
    page.locator(`[data-testid="thread-row"]:not([data-thread-id="${firstId}"])`),
  );

  // Both idle threads are listed under their project, and nothing is flagged yet.
  await page.getByTestId('sidebar-needs').click();
  await expect(page.getByTestId('inbox-page')).toBeVisible();
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  for (const threadId of [firstId, secondId]) {
    await expect(inboxRow(page, threadId)).toBeVisible();
    await expect(inboxRow(page, threadId).getByTestId('inbox-project')).toHaveText('project');
  }
  await expect(page.getByTestId('sidebar-needs-badge')).toHaveCount(0);

  // The mock provider asks for a bash approval, which holds the thread at the gate.
  await page.locator(`[data-testid="thread-row"][data-thread-id="${firstId}"]`).click();
  await expect(page.getByTestId('thread-title')).toBeVisible();
  await sendMessage(page, 'run-bash');
  await expect(page.getByTestId('approval-card')).toBeVisible();

  // The badge counts it, and the row carries the reason line plus both decisions.
  await page.getByTestId('sidebar-needs').click();
  await expect(page.getByTestId('sidebar-needs-badge')).toHaveText('1');
  const approvalRow = inboxRow(page, firstId);
  await expect(approvalRow).toHaveAttribute('data-reason', 'needs-approval');
  await expect(page.getByTestId('inbox-group-needs-approval')).toBeVisible();
  await expect(approvalRow.getByTestId('inbox-reason')).toContainText('bash');
  await expect(approvalRow.getByTestId('inbox-reason')).toContainText('tuffcode-ok');
  await expect(approvalRow.getByTestId('inbox-allow')).toBeVisible();
  await expect(approvalRow.getByTestId('inbox-deny')).toBeVisible();

  // Allow resolves the approval in place; the run is no longer blocked, so the
  // badge clears and the buttons leave the row.
  await approvalRow.getByTestId('inbox-allow').click();
  await expect(page.getByTestId('sidebar-needs-badge')).toHaveCount(0);
  await expect(approvalRow.getByTestId('inbox-allow')).toHaveCount(0);

  // A row opens its thread route.
  await inboxRow(page, secondId).getByTestId('inbox-title').click();
  await expect(page.getByTestId('thread-title')).toBeVisible();
  await expect(page.locator('[data-testid="thread-row"][aria-current="page"]')).toHaveAttribute(
    'data-thread-id',
    secondId,
  );
});
