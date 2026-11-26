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

/** The three kinds a steps body can hold, in the order it renders them. */
const STEP_SELECTOR = [
  '[data-testid="reasoning-block"]',
  '[data-testid="assistant-prose"]',
  '[data-testid="tool-row"]',
  '[data-testid="tool-group"]',
].join(', ');

test('renders a completed turn as one steps row above the answer, expanded on click', async ({
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

  // While the answer streams the work stays flat, so live progress is visible.
  await expect(page.getByTestId('reasoning-block').last()).toBeVisible();
  await expect(page.getByTestId('steps-block')).toHaveCount(0);

  await expectAssistantText(page, MOCK_TIMELINE_FINAL);

  // The finished turn folds its reasoning, prose and tools into one row above the
  // answer, collapsed by default.
  const steps = page.getByTestId('steps-block').last();
  await expect(steps).toContainText('Ran 3 tools and thought for');
  await expect(steps.getByTestId('steps-body')).toHaveCount(0);
  await expect(page.getByTestId('reasoning-block')).toHaveCount(0);

  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'timeline';
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-collapsed.png`) });
  }

  await steps.getByRole('button').first().click();
  const body = steps.getByTestId('steps-body');
  await expect(body).toBeVisible();

  const order = await body
    .locator(STEP_SELECTOR)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(order).toEqual(['reasoning-block', 'assistant-prose', 'tool-group']);

  const reasoning = body.getByTestId('reasoning-block');
  await expect(reasoning).toContainText('Thought for');
  await reasoning.getByRole('button').click();
  await expect(reasoning).toContainText(MOCK_THINKING);

  await expect(body.getByTestId('assistant-prose')).toContainText(MOCK_PROSE);

  const group = body.getByTestId('tool-group');
  await expect(group).toContainText('Ran 3 tools');

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

  // A finished turn with reasoning and no tools folds to a thought-only row.
  await sendMessage(page, 'think-only');
  const thought = page.getByTestId('steps-block').last();
  await expect(thought).toContainText('Thought for');
  await expect(thought).not.toContainText('Ran');
  await thought.getByRole('button').first().click();
  const thoughtReasoning = thought.getByTestId('reasoning-block');
  await expect(thoughtReasoning).toBeVisible();
  await thoughtReasoning.getByRole('button').click();
  await expect(thoughtReasoning).toContainText(MOCK_THINKING);
});
