import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
  setPermissionMode,
} from './helpers';
import { MOCK_ALLOWED_TEXT, MOCK_MODEL_ID, MOCK_SUBAGENT_FINAL } from './mock-openai';

/**
 * Round 3 visual verification: every surface the round changed is captured as a PNG
 * and asserted by measurement, so a surface that renders but is wrong still fails.
 * Screenshots go to TUFFCODE_E2E_SHOTS when set, else the repo's gitignored
 * `.tuffcode-ops/shots/round3`.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SHOTS_DIR =
  process.env['TUFFCODE_E2E_SHOTS'] ?? join(repoRoot, '.tuffcode-ops', 'shots', 'round3');

/** The native caption buttons own the top-right corner of the window (D38). */
const CAPTION_INSET_PX = 140;
const ROOT_ROW_HEIGHT_PX = 48;
const ROOT_ROW_TOLERANCE_PX = 1;
const MODE_SWITCH_CENTER_TOLERANCE_PX = 40;
/** The title owns the left zone; a status chip there left it under 200px at 1440px. */
const THREAD_TITLE_MIN_WIDTH_PX = 200;
const FIRST_ROOT_TITLE = 'Plan the v0.1.3 release';
const SECOND_ROOT_TITLE = 'Review the council board';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element is not laid out, so it has no box');
  return box;
}

test('round 3 surfaces render at their measured sizes', async ({ session, workspace, mock, rpc }) => {
  const { page } = session;
  mkdirSync(SHOTS_DIR, { recursive: true });

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  const providerId = await seedDefaultModel(rpc);
  // Sonner pauses its dismiss timer while the window is unfocused, so the provider
  // toast would sit over the inspector in every capture. Close it explicitly.
  const toastClose = page
    .getByRole('region', { name: /Notifications/ })
    .getByRole('button', { name: 'Close toast' });
  await toastClose.first().click();
  await expect(toastClose).toHaveCount(0);

  // Two roots with readable titles; threads.create broadcasts thread.updated, so the
  // sidebar shows them without a reload. Root one later spawns the nested child.
  const projects = (await rpc.request('projects.list', {})) as { id: string }[];
  const projectId = projects[0]?.id;
  if (projectId === undefined) throw new Error('the project was not added');
  const firstRoot = (await rpc.request('threads.create', {
    projectId,
    title: FIRST_ROOT_TITLE,
    providerId,
    modelId: MOCK_MODEL_ID,
    executionMode: 'work',
    permissionMode: 'full-auto',
  })) as { id: string };
  const secondRoot = (await rpc.request('threads.create', {
    projectId,
    title: SECOND_ROOT_TITLE,
    providerId,
    modelId: MOCK_MODEL_ID,
    executionMode: 'work',
    permissionMode: 'full-auto',
  })) as { id: string };

  const rootRow = page.locator(`[data-testid="thread-row"][data-thread-id="${firstRoot.id}"]`);
  const secondRootRow = page.locator(
    `[data-testid="thread-row"][data-thread-id="${secondRoot.id}"]`,
  );
  const childRow = page.getByTestId('thread-child-row');
  await expect(page.getByTestId('thread-row')).toHaveCount(2);
  await expect(rootRow).toBeVisible();
  await expect(secondRootRow).toBeVisible();

  // The explorer runs a real child thread, which nests under its parent in the list.
  await rootRow.click();
  const threadTitle = page.getByTestId('thread-title');
  await expect(threadTitle).toHaveText(FIRST_ROOT_TITLE);
  await sendMessage(page, 'spawn-subagent');
  await expectAssistantText(page, MOCK_SUBAGENT_FINAL);
  await expect(childRow).toHaveCount(1);
  await expect(childRow).toBeVisible();

  const sidebar = page.locator('aside[aria-label="Projects and threads"]');
  await expect(sidebar).toBeVisible();

  // D38: a 48px root row, a shorter child row under it, indented by its own padding.
  const rootBox = await boxOf(rootRow);
  const childBox = await boxOf(childRow);
  const projectBox = await boxOf(page.getByTestId('project-toggle').first().locator('xpath=..'));
  const projectRowGap =
    (await boxOf(page.getByTestId('thread-row').first())).y - (projectBox.y + projectBox.height);
  const rootTitleBox = await boxOf(rootRow.locator('span').first());
  const childContentBox = await boxOf(childRow.locator('span').first());
  const rootIndent = rootTitleBox.x - rootBox.x;
  const childIndent = childContentBox.x - childBox.x;

  expect(rootBox.height).toBeGreaterThanOrEqual(ROOT_ROW_HEIGHT_PX - ROOT_ROW_TOLERANCE_PX);
  expect(rootBox.height).toBeLessThanOrEqual(ROOT_ROW_HEIGHT_PX + ROOT_ROW_TOLERANCE_PX);
  expect(childBox.height).toBeLessThan(rootBox.height);
  expect(childIndent).toBeGreaterThan(rootIndent + 10);
  // D38 keeps a 2px gap between sidebar rows.
  expect(Math.abs(projectRowGap - 2)).toBeLessThanOrEqual(1);
  // The child renders directly under the root it belongs to.
  expect(childBox.y).toBeGreaterThan(rootBox.y + rootBox.height);

  await sidebar.screenshot({ path: join(SHOTS_DIR, 'sidebar.png') });

  // The thread header: the Work/Council switch centered, the Activity control right.
  const header = page.locator('main header').first();
  await expect(header).toBeVisible();
  const modeSwitch = page.getByTestId('thread-mode-switch');
  await expect(modeSwitch).toBeVisible();
  await expect(page.getByTestId('activity-button')).toBeVisible();
  await expect(modeSwitch.getByRole('radio', { name: 'Work' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const headerBox = await boxOf(header);
  const switchBox = await boxOf(modeSwitch);
  const switchOffset = Math.abs(
    switchBox.x + switchBox.width / 2 - (headerBox.x + headerBox.width / 2),
  );
  expect(switchOffset).toBeLessThanOrEqual(MODE_SWITCH_CENTER_TOLERANCE_PX);

  // The breadcrumb and title own the left zone: the title keeps a readable width
  // instead of truncating after a dozen characters next to the status chip.
  const titleBox = await boxOf(threadTitle);
  expect(titleBox.width).toBeGreaterThanOrEqual(THREAD_TITLE_MIN_WIDTH_PX);

  // The topbar keeps every control clear of the caption-button corner.
  const topbar = page.locator('header').first();
  const windowWidth = await page.evaluate(() => window.innerWidth);
  const captionLimit = windowWidth - CAPTION_INSET_PX;
  const topbarControls = topbar.locator('a, button');
  const controlCount = await topbarControls.count();
  let widestControlRight = 0;
  for (let index = 0; index < controlCount; index += 1) {
    const control = topbarControls.nth(index);
    if (!(await control.isVisible())) continue;
    const controlBox = await boxOf(control);
    widestControlRight = Math.max(widestControlRight, controlBox.x + controlBox.width);
  }
  expect(widestControlRight).toBeLessThanOrEqual(captionLimit + 1);
  const activityBox = await boxOf(page.getByTestId('activity-button'));
  expect(activityBox.x + activityBox.width).toBeLessThanOrEqual(captionLimit + 1);

  await header.screenshot({ path: join(SHOTS_DIR, 'thread-header.png') });

  // Activity: a bash call waits for approval, so the panel has a live running row.
  await page.getByTestId('activity-button').click();
  const activityPanel = page.getByTestId('activity-panel');
  await expect(activityPanel).toBeVisible();
  await setPermissionMode(page, 'Ask');
  await sendMessage(page, 'run-bash');
  await expect(page.getByTestId('approval-card').last()).toBeVisible();

  const runningTools = page.getByTestId('activity-running-tool');
  await expect(runningTools.first()).toBeVisible();
  expect(await runningTools.count()).toBeGreaterThanOrEqual(1);
  await expect(runningTools.first()).toContainText('echo tuffcode-ok');
  await page.screenshot({ path: join(SHOTS_DIR, 'activity.png') });

  await page.getByTestId('approval-allow').last().click();
  await expectAssistantText(page, MOCK_ALLOWED_TEXT);
  await expect(runningTools).toHaveCount(0);
  await expect(page.getByTestId('activity-waiting-empty')).toBeVisible();
  await page.screenshot({ path: join(SHOTS_DIR, 'activity-idle.png') });

  // Council: the second root plans with the mock planner and draws the board.
  await secondRootRow.click();
  await expect(threadTitle).toHaveText(SECOND_ROOT_TITLE);
  await modeSwitch.getByRole('radio', { name: 'Council' }).click();
  const goalInput = page.getByTestId('council-goal-input');
  await expect(goalInput).toBeVisible();
  await expect(modeSwitch.getByRole('radio', { name: 'Council' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await goalInput.fill('Document the answer constant and re-export it');
  await page.getByTestId('council-send').click();

  const threadBoard = page.getByTestId('council-thread-board');
  await expect(threadBoard).toBeVisible();
  const board = page.getByTestId('council-board');
  await expect(board).toHaveAttribute('data-empty', 'false', { timeout: 60_000 });
  // The planner turn is a real provider round trip: wait for its tasks to exist, so
  // the capture shows task and reviewer nodes, not only planner and report.
  await expect(page.getByTestId('council-thread-board-counts')).toBeVisible({ timeout: 60_000 });
  const nodeCount = Number(await board.getAttribute('data-node-count'));
  expect(nodeCount).toBeGreaterThanOrEqual(3);
  const taskNodes = board.locator('[data-testid="council-board-node"][data-kind="task"]');
  expect(await taskNodes.count()).toBeGreaterThanOrEqual(1);
  await expect(board.getByTestId('council-board-node').first()).toBeVisible();

  // The board fits its surface: no scroll overflow and every node inside the frame.
  const boardBox = await boxOf(board);
  const overflow = await board.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1);
  const nodes = board.getByTestId('council-board-node');
  const renderedNodes = await nodes.count();
  for (let index = 0; index < renderedNodes; index += 1) {
    const nodeBox = await boxOf(nodes.nth(index));
    expect(nodeBox.x).toBeGreaterThanOrEqual(boardBox.x - 1);
    expect(nodeBox.x + nodeBox.width).toBeLessThanOrEqual(boardBox.x + boardBox.width + 1);
    expect(nodeBox.y).toBeGreaterThanOrEqual(boardBox.y - 1);
    expect(nodeBox.y + nodeBox.height).toBeLessThanOrEqual(boardBox.y + boardBox.height + 1);
  }

  // The board lives in the thread body, above the composer's goal box.
  const goalBox = await boxOf(goalInput);
  expect(boardBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(goalBox.y + 1);

  await page.screenshot({ path: join(SHOTS_DIR, 'council-thread.png') });

  // Settings > MCP: the empty state and the add form on one screen.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'MCP', exact: true }).click();
  await expect(page.getByText('No MCP servers yet')).toBeVisible();
  await page.getByTestId('mcp-add-server').click();
  await expect(page.getByTestId('mcp-label-input')).toBeVisible();
  await expect(page.getByTestId('mcp-command-input')).toBeVisible();
  // Measured, not asserted: at 1440x900 the submit row starts below the fold.
  const submitBox = await boxOf(page.locator('form button[type="submit"]'));
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  await page.screenshot({ path: join(SHOTS_DIR, 'mcp-settings.png') });

  console.log(
    'round3 measurements ' +
      JSON.stringify({
        shotsDir: SHOTS_DIR,
        rootRowHeight: rootBox.height,
        childRowHeight: childBox.height,
        projectRowHeight: projectBox.height,
        projectRowGap,
        rootIndent,
        childIndent,
        headerWidth: headerBox.width,
        titleWidth: titleBox.width,
        modeSwitchCenterOffset: switchOffset,
        topbarRightEdge: widestControlRight,
        captionLimit,
        councilNodeCount: nodeCount,
        councilBoardOverflow: overflow,
        mcpSubmitTop: submitBox.y,
        viewportHeight,
        mcpSubmitBelowFold: submitBox.y + submitBox.height - viewportHeight,
      }),
  );
});
