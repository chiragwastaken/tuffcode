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
  MOCK_INTERLEAVE_FINAL,
  MOCK_INTERLEAVE_PROSE_ONE,
  MOCK_INTERLEAVE_PROSE_TWO,
  MOCK_INTERLEAVE_REASONING_ONE,
  MOCK_INTERLEAVE_REASONING_TWO,
} from './mock-openai';

const STEP_SELECTOR = [
  '[data-testid="reasoning-block"]',
  '[data-testid="assistant-prose"]',
  '[data-testid="tool-row"]',
  '[data-testid="tool-group"]',
].join(', ');

function blockKind(testId: string | null): string {
  switch (testId) {
    case 'reasoning-block':
      return 'reasoning';
    case 'assistant-prose':
      return 'prose';
    case 'tool-row':
    case 'tool-group':
      return 'tools';
    default:
      return String(testId);
  }
}

test('keeps reasoning, prose and tools in event order inside the steps row', async ({
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

  await sendMessage(page, 'interleave-timeline');

  // Live progress stays flat until the answer settles.
  await expect(page.getByTestId('reasoning-block').first()).toBeVisible();
  await expect(page.getByTestId('steps-block')).toHaveCount(0);

  await expectAssistantText(page, MOCK_INTERLEAVE_FINAL);

  const steps = page.getByTestId('steps-block').last();
  await expect(steps).toContainText('Ran 2 tools and thought for');
  await steps.getByRole('button').first().click();
  const body = steps.getByTestId('steps-body');

  // The turn runs two tool iterations; each one reopens reasoning and prose, so
  // the DOM order inside the expanded body is the assertion, never a timestamp.
  const testIds = await body
    .locator(STEP_SELECTOR)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(testIds.map(blockKind)).toEqual([
    'reasoning',
    'prose',
    'tools',
    'reasoning',
    'prose',
    'tools',
  ]);

  const prose = body.getByTestId('assistant-prose');
  await expect(prose.nth(0)).toContainText(MOCK_INTERLEAVE_PROSE_ONE);
  await expect(prose.nth(1)).toContainText(MOCK_INTERLEAVE_PROSE_TWO);

  const reasoning = body.getByTestId('reasoning-block');
  await reasoning.nth(0).getByRole('button').click();
  await expect(reasoning.nth(0)).toContainText(MOCK_INTERLEAVE_REASONING_ONE);
  await reasoning.nth(1).getByRole('button').click();
  await expect(reasoning.nth(1)).toContainText(MOCK_INTERLEAVE_REASONING_TWO);

  // The answer itself stays outside the fold.
  await expect(page.getByTestId('assistant-message').last()).toContainText(MOCK_INTERLEAVE_FINAL);
});
