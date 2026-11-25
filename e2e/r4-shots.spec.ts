import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  openSettingsSection,
  seedDefaultModel,
  sendMessage,
  setPermissionMode,
} from './helpers';
import { MOCK_SUBAGENT_FINAL, MOCK_TODO_FINAL, MOCK_TODO_ITEMS } from './mock-openai';

/**
 * Round 4 visual verification. Every surface the round changed is driven through the
 * real app and captured as a PNG in `.tuffcode-ops/shots/r4` (or TUFFCODE_E2E_SHOTS).
 * The suite never reaches the network: the plugin catalogs are seeded as fresh cache
 * files, so the hub reads them without fetching, and the Connectors tab is not opened.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SHOTS_DIR = process.env['TUFFCODE_E2E_SHOTS'] ?? join(repoRoot, '.tuffcode-ops', 'shots', 'r4');

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), animations: 'disabled' });
}

/** Fresh cache files for the four built-in marketplaces, so the hub never fetches. */
function seedCatalogs(home: string): void {
  const dir = join(home, 'cache', 'marketplaces');
  mkdirSync(dir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const catalogs: Record<string, unknown[]> = {
    official: [
      { name: 'github', displayName: 'GitHub', description: 'Issues, pull requests and code search.', category: 'development', source: './plugins/github', mcpServers: { github: {} } },
      { name: 'frontend-design', description: 'Distinctive production-grade interfaces.', category: 'design', source: './plugins/frontend-design', skills: ['./skills/frontend-design'] },
    ],
    'knowledge-work': [
      { name: 'productivity', displayName: 'Productivity', description: 'Plan your day and keep track of work.', category: 'productivity', source: './productivity' },
    ],
    skills: [{ name: 'document-skills', description: 'Excel, Word, PowerPoint and PDF.', source: './', skills: ['./skills/pdf', './skills/docx'] }],
    community: [
      { name: 'telegram-bridge', description: 'Telegram channel for chats.', category: 'productivity', source: { source: 'url', url: 'https://github.com/example/telegram-bridge.git' } },
    ],
  };
  for (const [id, entries] of Object.entries(catalogs)) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ fetchedAt, skipped: 0, entries }));
  }
}

test('round 4: sidebar, search, dock toolbar, todo list, splits and model menu', async ({
  session,
  workspace,
  mock,
  rpc,
}) => {
  const { page } = session;
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);

  // Sidebar: New chat, Search and Plugins replace the inline filter.
  await expect(page.getByTestId('sidebar-search')).toBeVisible();
  await expect(page.getByTestId('sidebar-plugins')).toBeVisible();
  await expect(page.getByPlaceholder('Search projects and threads')).toHaveCount(0);

  await createThreadThroughSidebar(page);
  await setPermissionMode(page, 'Full auto');

  // A new chat is titled from its first message, not an id fragment.
  await sendMessage(page, 'todo-plan for the release notes');
  await expectAssistantText(page, MOCK_TODO_FINAL);
  await expect(page.getByTestId('thread-title')).toHaveText('Todo-plan for the release notes');

  // The todo list is live above the composer and in Activity.
  await expect(page.getByTestId('todo-strip')).toContainText(MOCK_TODO_ITEMS[0] ?? '');
  await expect(page.getByTestId('dock')).toHaveCount(0);
  await page.getByTestId('dock-toggle-activity').click();
  await expect(page.getByTestId('dock')).toBeVisible();
  await expect(page.getByTestId('activity-todo').getByTestId('todo-item')).toHaveCount(3);
  await expect(page.getByTestId('activity-context')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-context')).toHaveCount(0);
  await shot(page, 'activity-docked');

  // The dock never overlays the chat: it sits beside it.
  const dockBox = await page.getByTestId('dock').boundingBox();
  const workspaceBox = await page.getByTestId('pane-workspace').boundingBox();
  expect(dockBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect((workspaceBox?.x ?? 0) + (workspaceBox?.width ?? 0)).toBeLessThanOrEqual((dockBox?.x ?? 0) + 1);

  // Terminal opens only on request; Files lists the worktree with a filter.
  await page.getByTestId('dock-toggle-terminal').click();
  await expect(page.getByTestId('inspector-tab-terminal')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('dock-toggle-files').click();
  await expect(page.getByTestId('files-row').first()).toBeVisible();
  await page.getByTestId('files-filter').fill('index');
  await expect(page.getByTestId('files-row').filter({ hasText: 'index.ts' })).toBeVisible();
  await shot(page, 'files-docked');
  await page.getByTestId('inspector-collapse').click();
  await expect(page.getByTestId('dock')).toHaveCount(0);

  // Split view and a side chat from the + menu.
  await page.getByTestId('dock-add-menu').click();
  await page.getByTestId('dock-add-split').click();
  await expect(page.getByTestId('pane-workspace')).toHaveAttribute('data-pane-count', '2');
  await shot(page, 'split-view');

  // Search finds the chat by title.
  await page.getByTestId('sidebar-search').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  await page.getByTestId('search-input').fill('release');
  await expect(page.getByTestId('search-hit-chat').first()).toContainText('Todo-plan for the release notes');
  await shot(page, 'search-dialog');
  await page.keyboard.press('Escape');

  // Model menu: providers, models, reasoning and subagent models in one popover.
  await page.getByTestId('model-menu-trigger').click();
  await expect(page.getByTestId('model-menu')).toBeVisible();
  await expect(page.getByTestId('model-menu-provider').first()).toBeVisible();
  await expect(page.getByTestId('model-menu-effort-none')).toBeVisible();
  await shot(page, 'model-menu');
  await page.getByTestId('model-menu-tab-subagents').click();
  await expect(page.getByTestId('subagent-model-explorer')).toBeVisible();
  await shot(page, 'model-menu-subagents');
  await page.keyboard.press('Escape');

  // Subagent telemetry: tool count and tokens per child in Activity.
  await sendMessage(page, 'spawn-subagent');
  await expectAssistantText(page, MOCK_SUBAGENT_FINAL);
  await page.getByTestId('dock-toggle-activity').click();
  await expect(page.getByTestId('activity-subagent-usage').first()).toContainText(/tools|usage/);
  await shot(page, 'subagent-telemetry');
});

test('round 4: plugins hub and settings sections', async ({ session, workspace, mock, rpc }) => {
  const { page } = session;
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  await seedDefaultModel(rpc);
  seedCatalogs(workspace.home);

  await page.getByTestId('sidebar-plugins').click();
  await expect(page.getByTestId('plugins-page')).toBeVisible();
  await expect(page.getByTestId('plugins-verified').getByTestId('plugin-card')).toHaveCount(4);
  await expect(page.getByTestId('plugins-community').getByTestId('plugin-card')).toHaveCount(1);
  await page.getByTestId('plugins-tabs').getByRole('radio', { name: 'Skills' }).click();
  await expect(page.getByTestId('plugins-verified').getByTestId('plugin-card')).toHaveCount(2);
  await page.getByTestId('plugins-tabs').getByRole('radio', { name: 'All' }).click();
  await shot(page, 'plugins-hub');
  await page.getByTestId('plugins-add').click();
  await expect(page.getByTestId('plugins-add-connector')).toBeVisible();
  await page.getByTestId('plugins-add-connector').click();
  await expect(page.getByTestId('custom-connector-dialog')).toBeVisible();
  await shot(page, 'custom-connector');
  await page.keyboard.press('Escape');

  for (const [section, testId, name] of [
    ['Models', 'models-merged-section', 'settings-models'],
    ['Your Tuffcode', 'your-tuffcode-section', 'settings-your-tuffcode'],
    ['Capabilities', 'capabilities-section', 'settings-capabilities'],
    ['Notifications', 'notifications-section', 'settings-notifications'],
    ['Plugins', 'plugins-settings-section', 'settings-plugins'],
  ] as const) {
    await openSettingsSection(page, section);
    await expect(page.getByTestId(testId)).toBeVisible();
    await shot(page, name);
    await page.getByRole('link', { name: 'Back to workspace' }).click();
  }

  // Capabilities are real switches: turning Skills off persists through the server.
  await openSettingsSection(page, 'Capabilities');
  await page.getByTestId('cap-skills').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect
    .poll(async () => ((await rpc.request('settings.get', {})) as { capabilities: { skills: boolean } }).capabilities.skills)
    .toBe(false);
});
