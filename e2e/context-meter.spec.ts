import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
  addMockProvider,
  addProjectThroughUi,
  createThreadThroughSidebar,
  expectAssistantText,
  seedDefaultModel,
  sendMessage,
} from './helpers';
import { MOCK_MODEL_ID, MOCK_TEXT } from './mock-openai';

interface ProviderSummary {
  id: string;
  config: Record<string, unknown>;
}

test('shows the context meter and opens its breakdown popover', async ({
  session,
  workspace,
  mock,
  rpc,
}) => {
  const { page } = session;

  await addProjectThroughUi(session, workspace);
  await addMockProvider(page, mock);
  const providerId = await seedDefaultModel(rpc);

  // A small window makes the meter visible in a screenshot. This is the same
  // per-model override the provider form writes, not a renderer-side stub.
  const providers = (await rpc.request('providers.list', {})) as ProviderSummary[];
  const provider = providers.find((entry) => entry.id === providerId);
  if (provider === undefined) throw new Error('the mock provider was not saved');
  await rpc.request('providers.upsert', {
    id: providerId,
    kind: 'openai-compatible',
    label: 'Mock Provider',
    config: {
      ...provider.config,
      models: [
        {
          id: MOCK_MODEL_ID,
          label: MOCK_MODEL_ID,
          contextWindow: 900,
          maxOutputTokens: 512,
          isDefault: true,
        },
      ],
    },
  });

  await createThreadThroughSidebar(page);
  await sendMessage(page, 'Say hello to the e2e suite');
  await expectAssistantText(page, MOCK_TEXT);

  const meter = page.getByTestId('context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute('data-tone', 'warning');
  await expect(meter).toContainText('%');

  // The provider-added toast would sit over the audit screenshots.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'context-meter';
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-chip.png`) });
  }

  await meter.click();
  const breakdown = page.getByTestId('context-breakdown');
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText('Context');
  await expect(breakdown).toContainText('tokens');
  await expect(breakdown.getByRole('list', { name: 'Context segments' })).toBeVisible();
  await expect(breakdown.getByTestId('context-compact-now')).toHaveText('Compact now');

  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-breakdown.png`) });
  }
});
