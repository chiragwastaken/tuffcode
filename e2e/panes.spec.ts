import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  seedDefaultModel,
  closeDock,
  openDock,
} from './helpers';

/**
 * The split-pane row: two and three panes, a resized splitter, a tab dragged
 * between headers, the narrow collapse, and a layout that survives a restart.
 */
test('splits into two and three panes, drags a tab, collapses narrow, and persists', async ({
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

  // The inspector's 560px column would put the row below 1100px, where panes
  // deliberately collapse into tabs.
  await closeDock(page);

  const workspaceEl = page.getByTestId('pane-workspace');
  await expect(workspaceEl).toHaveAttribute('data-narrow', 'false');
  await expect(page.getByTestId('pane')).toHaveCount(1);
  await expect(page.getByTestId('pane-tab').filter({ hasText: 'Thread' })).toBeVisible();

  // Two panes: thread and diff, with a draggable splitter between them.
  await page.getByTestId('pane-split').click();
  await page.getByTestId('pane-split-surface-diff').click();
  await expect(page.getByTestId('pane')).toHaveCount(2);
  const diffPane = page.getByTestId('pane').nth(1);
  await expect(diffPane).toHaveAttribute('data-surface', 'diff');
  await expect(diffPane.getByTestId('diff-panel')).toBeVisible();
  await expect(diffPane.getByRole('status', { name: 'Loading diff' })).toHaveCount(0);
  await expect(page.getByTestId('pane-splitter')).toHaveCount(1);

  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'panes';
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-two.png`) });
  }

  // The splitter trades width with its neighbour, and a double click restores 50/50.
  const threadPane = page.getByTestId('pane').first();
  const beforeDrag = await threadPane.boundingBox();
  const splitter = page.getByTestId('pane-splitter');
  const splitterBox = await splitter.boundingBox();
  if (beforeDrag === null || splitterBox === null) throw new Error('pane row has no box');
  await page.mouse.move(
    splitterBox.x + splitterBox.width / 2,
    splitterBox.y + splitterBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    splitterBox.x + splitterBox.width / 2 - 140,
    splitterBox.y + splitterBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  const afterDrag = await threadPane.boundingBox();
  expect(afterDrag?.width ?? 0).toBeLessThan(beforeDrag.width - 80);

  await splitter.dblclick();
  const leftAfterReset = await threadPane.boundingBox();
  const rightAfterReset = await diffPane.boundingBox();
  expect(Math.abs((leftAfterReset?.width ?? 0) - (rightAfterReset?.width ?? 0))).toBeLessThan(4);

  // Three panes: a terminal joins the row.
  await diffPane.getByTestId('pane-split').click();
  await page.getByTestId('pane-split-surface-terminal').click();
  await expect(page.getByTestId('pane')).toHaveCount(3);
  const terminalPane = page.getByTestId('pane').nth(2);
  await expect(terminalPane).toHaveAttribute('data-surface', 'terminal');
  await expect(terminalPane.getByTestId('terminal-panel')).toBeVisible();
  await expect(terminalPane.locator('[data-terminal-id]')).toBeVisible();

  const thirds = await Promise.all(
    [0, 1, 2].map((index) => page.getByTestId('pane').nth(index).boundingBox()),
  );
  const thirdWidths = thirds.map((box) => box?.width ?? 0);
  expect(Math.max(...thirdWidths) - Math.min(...thirdWidths)).toBeLessThan(6);
  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-three.png`) });
  }

  // Dropping a tab on another header moves the surface and closes its empty pane.
  const terminalTab = terminalPane.getByTestId('pane-tab').filter({ hasText: 'Terminal' });
  await terminalTab.dragTo(page.getByTestId('pane-header').first());
  await expect(page.getByTestId('pane')).toHaveCount(2);
  await expect(threadPane).toHaveAttribute('data-surface', 'terminal');
  await expect(threadPane.getByTestId('pane-tab').filter({ hasText: 'Terminal' })).toBeVisible();
  await expect(threadPane.getByTestId('pane-tab-close')).toHaveCount(1);

  // Below 1100px the row keeps one pane; every surface becomes a tab.
  await openDock(page, 'activity');
  await expect(workspaceEl).toHaveAttribute('data-narrow', 'true');
  await expect(page.getByTestId('pane')).toHaveCount(1);
  await expect(page.getByTestId('pane-tab')).toHaveCount(3);
  await expect(page.getByTestId('pane-tab').filter({ hasText: 'Terminal' })).toBeVisible();
  await expect(page.getByTestId('pane-tab').filter({ hasText: 'Diff' })).toBeVisible();
  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-narrow.png`) });
  }

  // Selecting a tab in the narrow row writes back to its owning pane.
  await page.getByTestId('pane-tab').filter({ hasText: 'Thread' }).click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-surface', 'thread');
  await closeDock(page);
  await expect(workspaceEl).toHaveAttribute('data-narrow', 'false');
  await expect(page.getByTestId('pane')).toHaveCount(2);
  await expect(page.getByTestId('pane').first()).toHaveAttribute('data-surface', 'thread');

  // Ctrl+W closes the focused pane while more than one is open.
  await page.getByTestId('pane-header').nth(1).getByTestId('pane-drag-handle').click();
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('pane')).toHaveCount(1);

  // Ctrl+\ splits with the next surface; the menu then adds a third pane.
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('pane')).toHaveCount(2);
  await expect(page.getByTestId('pane').nth(1)).toHaveAttribute('data-surface', 'diff');
  await page.getByTestId('pane').nth(1).getByTestId('pane-split').click();
  await page.getByTestId('pane-split-surface-brain').click();
  await expect(page.getByTestId('pane')).toHaveCount(3);

  await session.relaunch();
  await expect(session.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'open',
  );
  const relaunched = session.page.getByTestId('pane-workspace');
  await expect(relaunched).toHaveAttribute('data-pane-count', '3');
  await closeDock(session.page);
  await expect(relaunched).toHaveAttribute('data-narrow', 'false');
  await expect(session.page.getByTestId('pane')).toHaveCount(3);
  await expect(session.page.getByTestId('pane').nth(2)).toHaveAttribute('data-surface', 'brain');
});
