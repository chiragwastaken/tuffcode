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
  setPermissionMode,
} from './helpers';
import {
  MOCK_PROSE,
  MOCK_TEXT,
  MOCK_THINKING,
  MOCK_TIMELINE_FILE,
  MOCK_TIMELINE_FINAL,
} from './mock-openai';

test('renders a turn as thinking, prose, one tool group, then the answer', async ({
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

  await sendMessage(page, 'show-timeline');
  await expectAssistantText(page, MOCK_TIMELINE_FINAL);

  const reasoning = page.getByTestId('reasoning-block').last();
  await expect(reasoning).toContainText('Thought for');
  await reasoning.getByRole('button').click();
  await expect(reasoning).toContainText(MOCK_THINKING);

  await expect(page.getByTestId('assistant-prose').last()).toContainText(MOCK_PROSE);

  const group = page.getByTestId('tool-group').last();
  await expect(group).toContainText('Ran 3 tools');

  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'timeline';
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-collapsed.png`) });
  }

  await group.getByRole('button').first().click();
  const rows = group.getByTestId('tool-row');
  await expect(rows).toHaveCount(3);

  const write = rows.filter({ hasText: MOCK_TIMELINE_FILE });
  await expect(write).toContainText('Wrote');
  await write.getByRole('button').click();
  await expect(write.getByTestId('tool-diff')).toContainText('alpha');
  await expect(write.getByTestId('tool-diff')).toContainText('beta');

  const grep = rows.filter({ hasText: 'Searched' });
  await grep.getByRole('button').click();
  await expect(grep.getByTestId('tool-matches')).toContainText('src/index.ts');
  await expect(grep.getByTestId('tool-matches')).toContainText('answer');

  const bash = rows.filter({ hasText: 'Ran' });
  await bash.getByRole('button').click();
  await expect(bash.getByTestId('tool-output')).toContainText('timeline-ok');

  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-expanded.png`) });
  }

  const answer = page.getByTestId('assistant-message').last();
  await answer.hover();
  await page.getByTestId('final-copy').last().click();
  await expect(page.getByTestId('final-copy').last()).toHaveAttribute('data-copied', 'true');

  const before = mock.requests;
  await page.getByTestId('final-retry').last().click();
  await expect.poll(() => mock.requests).toBeGreaterThan(before);
  await expect(page.getByTestId('assistant-message')).toHaveCount(2);
  await expect(page.getByTestId('thread-status')).toHaveAttribute(
    'data-status',
    'ready-to-review',
  );

  const retried = page.getByTestId('assistant-message').last();
  await retried.hover();
  await page.getByTestId('final-edit').last().click();
  const editor = page.getByTestId('final-edit-input');
  await expect(editor).toHaveValue('show-timeline');
  await editor.fill('Say hello after the edit');
  await page.getByTestId('final-edit-submit').click();

  await expect(
    page.getByTestId('user-message').filter({ hasText: 'Say hello after the edit' }),
  ).toBeVisible();
  await expectAssistantText(page, MOCK_TEXT);
});
