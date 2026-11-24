import { expect, type Page } from '@playwright/test';
import { stubFolderDialog, type AppSession, type E2EWorkspace } from './fixtures';
import { MOCK_MODEL_ID, type MockOpenAI } from './mock-openai';
import type { HarnessRpc } from './rpc';

export const PROVIDER_LABEL = 'Mock Provider';

interface ProviderSummary {
  id: string;
  label: string;
}

/** Adds the temp repository through the real Add project IPC path. */
export async function addProjectThroughUi(
  session: AppSession,
  workspace: E2EWorkspace,
): Promise<void> {
  await stubFolderDialog(session.app, workspace.projectPath);
  await session.page.getByTestId('sidebar-add-project').click();
  await expect(
    session.page.getByTestId('project-name').filter({ hasText: 'project' }),
  ).toBeVisible();
}

/** Saves an OpenAI-compatible provider that points at the in-process mock endpoint. */
export async function addMockProvider(page: Page, mock: MockOpenAI): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Add provider' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#provider-kind').click();
  await page.getByRole('option', { name: 'OpenAI-compatible', exact: true }).click();
  await dialog.locator('#provider-label').fill(PROVIDER_LABEL);
  await dialog.locator('#provider-base-url').fill(mock.baseUrl);
  await dialog.getByRole('button', { name: 'Add provider' }).click();

  await expect(page.getByText('Provider added.')).toBeVisible();
  await expect(page.getByText(PROVIDER_LABEL)).toBeVisible();
}

/**
 * The provider dialog does not seed a model row, so the harness sets the default
 * provider and model through the same `settings.set` RPC the Models page uses.
 */
export async function seedDefaultModel(rpc: HarnessRpc): Promise<string> {
  const providers = (await rpc.request('providers.list', {})) as ProviderSummary[];
  const provider = providers.find((entry) => entry.label === PROVIDER_LABEL);
  if (provider === undefined) throw new Error('the mock provider was not saved');
  await rpc.request('settings.set', {
    patch: { defaultProviderId: provider.id, defaultModelId: MOCK_MODEL_ID },
  });
  return provider.id;
}

/** Clicks New thread and waits for the thread view to mount. */
export async function createThreadThroughSidebar(page: Page): Promise<string> {
  const button = page.getByTestId('sidebar-new-thread');
  await expect(button).toBeEnabled();
  await button.click();
  const title = page.getByTestId('thread-title');
  await expect(title).toBeVisible();
  return (await title.innerText()).trim();
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  const send = page.getByTestId('composer-send');
  await expect(send).toBeEnabled();
  await send.click();
}

export async function openSettingsSection(
  page: Page,
  section: 'General' | 'Providers',
): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: section, exact: true }).click();
}

export async function setPermissionMode(page: Page, label: string): Promise<void> {
  await page.getByLabel('Permission mode').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(page.getByLabel('Permission mode')).toContainText(label);
}

export async function expectAssistantText(page: Page, text: string): Promise<void> {
  await expect(
    page.getByTestId('assistant-message').filter({ hasText: text }).last(),
  ).toBeVisible();
}
