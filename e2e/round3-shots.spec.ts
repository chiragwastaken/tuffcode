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

/** True when two laid-out boxes share any pixel; touching edges do not count. */
function boxesIntersect(a: Box, b: Box): boolean {
  const horizontal = a.x < b.x + b.width && b.x < a.x + a.width;
  const vertical = a.y < b.y + b.height && b.y < a.y + a.height;
  return horizontal && vertical;
}

/** Every header control shares one row, so no pair of their boxes may intersect. */
function expectDisjointHeaderControls(boxes: Record<string, Box>, context: string): void {
  const entries = Object.entries(boxes);
  for (const [index, [name, box]] of entries.entries()) {
    for (const [otherName, otherBox] of entries.slice(index + 1)) {
      expect(boxesIntersect(box, otherBox), `${name} and ${otherName} overlap ${context}`).toBe(
        false,
      );
    }
  }
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

  // An untouched thread shows the Activity empty state. In the docked column the
  // description has to wrap inside the panel instead of clipping mid-sentence.
  await secondRootRow.click();
  await expect(page.getByTestId('thread-title')).toHaveText(SECOND_ROOT_TITLE);
  await page.getByTestId('activity-button').click();
  const activityPanelEmpty = page.getByTestId('activity-panel');
  await expect(activityPanelEmpty.getByText('Nothing running', { exact: true })).toBeVisible();
  const activityEmptyDescription = activityPanelEmpty.getByText(
    'Tool calls and subagents appear here while a turn runs.',
  );
  await expect(activityEmptyDescription).toBeVisible();
  expect(
    await activityEmptyDescription.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: join(SHOTS_DIR, 'activity-empty.png') });

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

  // D43: the Work/Council switch sits in the app topbar, centered, with the thread
  // header below it carrying only the title and the thread's own controls.
  const topbar = page.getByTestId('topbar');
  await expect(topbar).toBeVisible();
  const header = page.getByTestId('thread-header');
  const inspector = page.locator('aside[aria-label="Inspector"]');
  await expect(header).toBeVisible();
  const modeSwitch = page.getByTestId('thread-mode-switch');
  await expect(modeSwitch).toBeVisible();
  await expect(page.getByTestId('activity-button')).toBeVisible();
  await expect(modeSwitch.getByRole('radio', { name: 'Work' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // The switch is the topbar's child, not the thread header's; the header keeps a
  // compact fallback, which stays out of the way at this width.
  await expect(topbar.getByTestId('thread-mode-switch')).toBeVisible();
  await expect(header.getByTestId('thread-mode-switch')).toHaveCount(0);
  const compactSwitch = page.getByTestId('thread-mode-switch-compact');
  await expect(header.getByTestId('thread-mode-switch-compact')).toHaveCount(1);
  await expect(compactSwitch).toBeHidden();

  const topbarBox = await boxOf(topbar);
  const switchBox = await boxOf(modeSwitch);
  const switchOffset = Math.abs(
    switchBox.x + switchBox.width / 2 - (topbarBox.x + topbarBox.width / 2),
  );
  expect(switchOffset).toBeLessThanOrEqual(MODE_SWITCH_CENTER_TOLERANCE_PX);
  expect(
    Math.abs(switchBox.y + switchBox.height / 2 - (topbarBox.y + topbarBox.height / 2)),
  ).toBeLessThanOrEqual(1);
  // Centered absolutely, so it must clear both topbar clusters rather than push them.
  expectDisjointHeaderControls(
    {
      'thread-mode-switch': switchBox,
      'sidebar-toggle': await boxOf(topbar.getByRole('button', { name: /sidebar/ })),
      'inspector-toggle': await boxOf(topbar.getByRole('button', { name: /inspector/ })),
    },
    'in the topbar at 1440x900',
  );

  // Below 900px the topbar switch would collide with the brand and the right
  // controls, so the topbar hides it and the thread header shows a compact one.
  // The window may clamp on some platforms, so measure what actually happened.
  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(860, 900);
  });
  const modeGateState = () =>
    page.evaluate(() => {
      const isLaidOut = (testId: string): boolean => {
        const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
        return element !== null && element.getClientRects().length > 0;
      };
      const width = window.innerWidth;
      const compactVisible = isLaidOut('thread-mode-switch-compact');
      const topbarVisible = isLaidOut('thread-mode-switch');
      const narrowRule = compactVisible && !topbarVisible;
      const wideRule = !compactVisible && topbarVisible;
      return width < 900 ? narrowRule : wideRule;
    });
  await expect.poll(modeGateState, { timeout: 5000 }).toBe(true);
  const narrowWidth = await page.evaluate(() => window.innerWidth);
  const narrowSwitchVisible = narrowWidth < 900 ? 'compact' : 'topbar';

  if (narrowWidth < 900) {
    expect(narrowWidth).toBeLessThan(900);
    await expect(modeSwitch).toBeHidden();
    await expect(compactSwitch).toBeVisible();
    await expect(page.getByTestId('thread-status')).toBeHidden();

    // The compact control is the real switch, not a decoration: it flips the mode.
    await compactSwitch.getByRole('radio', { name: 'Council' }).click();
    await expect(compactSwitch.getByRole('radio', { name: 'Council' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await compactSwitch.getByRole('radio', { name: 'Work' }).click();
    await expect(compactSwitch.getByRole('radio', { name: 'Work' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The narrow header fits: the compact switch and Activity share the row without
    // touching, and the switch stays inside the header.
    const compactBox = await boxOf(compactSwitch);
    const narrowHeaderBox = await boxOf(header);
    expectDisjointHeaderControls(
      {
        'thread-mode-switch-compact': compactBox,
        'activity-button': await boxOf(page.getByTestId('activity-button')),
      },
      'in the thread header at the narrow width',
    );
    expect(compactBox.x).toBeGreaterThanOrEqual(narrowHeaderBox.x);
    expect(compactBox.x + compactBox.width).toBeLessThanOrEqual(
      narrowHeaderBox.x + narrowHeaderBox.width,
    );
  } else {
    // The platform clamped the window at or above 900px, so both controls follow the
    // same 900px rule: the topbar keeps the switch and the compact one stays hidden.
    expect(narrowWidth).toBeGreaterThanOrEqual(900);
    await expect(modeSwitch).toBeVisible();
    await expect(compactSwitch).toBeHidden();
    await expect(page.getByTestId('thread-status')).toBeVisible();
  }

  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440);
  await expect(modeSwitch).toBeVisible();
  await expect(compactSwitch).toBeHidden();

  const headerBox = await boxOf(header);

  // The breadcrumb and title own the left zone: the title keeps a readable width
  // instead of truncating after a dozen characters next to the status chip.
  const titleBox = await boxOf(threadTitle);
  expect(titleBox.width).toBeGreaterThanOrEqual(THREAD_TITLE_MIN_WIDTH_PX);

  // D43: the header is one row, so no control may sit on another. The inspector
  // column is open at this width, which is the narrow-header case from the report.
  await expect(inspector).toBeVisible();
  const branchChip = page.getByTestId('thread-branch');
  // The thread owns a worktree branch, so the chip is in the document; the header
  // container is below its 64rem gate at 1440x900, so it must not be laid out.
  await expect(branchChip).toHaveCount(1);
  await expect(branchChip).toBeHidden();
  const statusBox = await boxOf(page.getByTestId('thread-status'));
  const activityButtonBox = await boxOf(page.getByTestId('activity-button'));
  expectDisjointHeaderControls(
    {
      'thread-title': titleBox,
      'thread-status': statusBox,
      'activity-button': activityButtonBox,
    },
    'at 1440x900',
  );

  // The reported window: 1550px wide with the inspector open leaves the header far
  // narrower than the viewport, so the branch chip stays gated out and the right
  // zone stays inside its column.
  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1550, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1500);
  await expect(branchChip).toBeHidden();
  const wideHeaderBox = await boxOf(header);
  expectDisjointHeaderControls(
    {
      'thread-title': await boxOf(threadTitle),
      'thread-status': await boxOf(page.getByTestId('thread-status')),
      'activity-button': await boxOf(page.getByTestId('activity-button')),
    },
    'at 1550x900',
  );

  // Past the container gate the chip does render; it then has to stay inside the
  // right zone, truncating its branch instead of pushing the title.
  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1920, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1920);
  await expect(branchChip).toBeVisible();
  const wideBranchBox = await boxOf(branchChip);
  const wideHeaderBoxAt1920 = await boxOf(header);
  expectDisjointHeaderControls(
    {
      'thread-title': await boxOf(threadTitle),
      'thread-status': await boxOf(page.getByTestId('thread-status')),
      'activity-button': await boxOf(page.getByTestId('activity-button')),
      'thread-branch': wideBranchBox,
    },
    'at 1920x900',
  );

  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440);

  // The topbar keeps every control clear of the caption-button corner.
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

  // A 1366px laptop at 125% scaling is about 1092 CSS px. The inspector docks there
  // as a static column: no dimming backdrop, and the main panel keeps its width.
  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1100);
  await expect(inspector).toBeVisible();
  // The backdrop stays mounted while the inspector shows and is display:none once
  // the panel is docked, so the main panel is neither dimmed nor inert.
  await expect(page.getByTestId('inspector-backdrop')).toBeHidden();
  await expect(inspector).not.toHaveAttribute('role', 'dialog');
  expect(await page.evaluate(() => document.querySelector('main')?.inert)).toBe(false);
  await expect(header).toBeVisible();
  const dockedInspectorBox = await boxOf(inspector);
  expect(dockedInspectorBox.width).toBeGreaterThanOrEqual(360);
  expect(dockedInspectorBox.width).toBeLessThanOrEqual(560);
  await page.screenshot({ path: join(SHOTS_DIR, 'inspector-docked-1100.png') });

  await session.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440);
  await expect(inspector).toBeVisible();

  await header.screenshot({ path: join(SHOTS_DIR, 'thread-header.png') });
  // The topbar with the centered Work/Council switch (D43).
  await topbar.screenshot({ path: join(SHOTS_DIR, 'topbar.png') });

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
        statusWidth: statusBox.width,
        activityButtonWidth: activityButtonBox.width,
        topbarWidth: topbarBox.width,
        topbarHeight: topbarBox.height,
        modeSwitchWidth: switchBox.width,
        modeSwitchCenterOffset: switchOffset,
        narrowInnerWidth: narrowWidth,
        narrowSwitchVisible,
        headerWidthAt1550: wideHeaderBox.width,
        headerWidthAt1920: wideHeaderBoxAt1920.width,
        branchWidthAt1920: wideBranchBox.width,
        topbarRightEdge: widestControlRight,
        captionLimit,
        inspectorWidthAt1100: dockedInspectorBox.width,
        councilNodeCount: nodeCount,
        councilBoardOverflow: overflow,
        mcpSubmitTop: submitBox.y,
        viewportHeight,
        mcpSubmitBelowFold: submitBox.y + submitBox.height - viewportHeight,
      }),
  );
});
