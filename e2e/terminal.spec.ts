import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  closeDock,
  createThreadThroughSidebar,
  openDock,
  seedDefaultModel,
} from './helpers';

interface ThreadDetail {
  id: string;
  worktreePath: string | null;
}

const ECHO_TOKEN = 'tuffcode-terminal-ok';
const REOPEN_TOKEN = 'tuffcode-terminal-again';

/** xterm's DOM renderer keeps one div per row under `.xterm-rows`. */
function terminalRows(page: Page): Locator {
  return page.getByTestId('terminal-panel').locator('.xterm-rows');
}

/**
 * The rendered rows with every whitespace run removed, so a token the pty wrapped
 * at its column boundary still reads as one contiguous string.
 */
async function terminalText(page: Page): Promise<string> {
  return (await terminalRows(page).innerText()).replace(/\s+/g, '');
}

/** Clicks the xterm screen for focus, then types one line and submits it. */
async function typeLine(page: Page, line: string): Promise<void> {
  const screen = page.getByTestId('terminal-panel').locator('.xterm-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

test('the dock terminal runs the thread shell, reports its cwd, and reopens', async ({
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

  const threadId = await page
    .locator('[data-testid="thread-row"][aria-current="page"]')
    .getAttribute('data-thread-id');
  if (threadId === null) throw new Error('the new thread has no selected sidebar row');
  const thread = (await rpc.request('threads.get', { id: threadId })) as ThreadDetail;
  if (thread.worktreePath === null) throw new Error('the thread has no worktree path');

  await openDock(page, 'terminal');
  await expect(page.getByTestId('terminal-panel')).toBeVisible();

  // The pty can print its first prompt before the renderer subscribes, so nudge the
  // shell with Enter and wait for a fresh prompt instead of racing the first one.
  const screen = page.getByTestId('terminal-panel').locator('.xterm-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  await page.keyboard.press('Enter');
  await expect.poll(async () => terminalRows(page).innerText()).toMatch(/PS [A-Za-z]:\\/);

  // The pty echoes the typed command and the shell prints its result, so the token
  // has to appear twice: once as input, once as output.
  await typeLine(page, `echo ${ECHO_TOKEN}`);
  await expect
    .poll(async () => (await terminalText(page)).split(ECHO_TOKEN).length - 1)
    .toBeGreaterThanOrEqual(2);

  // Get-Location compares the pty cwd to the thread worktree inside the shell, so a
  // wrapped long path cannot fake a match and the answer stays one short line.
  const expected = thread.worktreePath.replaceAll('/', '\\').replaceAll("'", "''");
  await typeLine(page, `Write-Output ('cwdsame=' + ((Get-Location).Path -eq '${expected}'))`);
  await expect.poll(async () => terminalText(page)).toContain('cwdsame=True');

  // Closing the dock kills the pty; reopening spawns a fresh one that still works.
  await closeDock(page);
  await openDock(page, 'terminal');
  await expect(page.getByTestId('terminal-panel')).toBeVisible();
  await typeLine(page, `echo ${REOPEN_TOKEN}`);
  await expect
    .poll(async () => (await terminalText(page)).split(REOPEN_TOKEN).length - 1)
    .toBeGreaterThanOrEqual(2);

  expect(session.pageErrors).toEqual([]);
  expect(session.consoleErrors).toEqual([]);
});
