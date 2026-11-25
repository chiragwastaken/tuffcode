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

const BLOCK_SELECTOR = [
  '[data-testid="reasoning-block"]',
  '[data-testid="assistant-prose"]',
  '[data-testid="tool-row"]',
  '[data-testid="tool-group"]',
  '[data-testid="assistant-message"]',
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
    case 'assistant-message':
      return 'answer';
    default:
      return String(testId);
  }
}

test('renders reasoning, prose and tools in event order across one turn', async ({
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
  await expectAssistantText(page, MOCK_INTERLEAVE_FINAL);

  // The turn runs two tool iterations; each one reopens reasoning and prose, so
  // the DOM order is the assertion, never a timestamp comparison.
  const testIds = await page
    .locator(BLOCK_SELECTOR)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(testIds.map(blockKind)).toEqual([
    'reasoning',
    'prose',
    'tools',
    'reasoning',
    'prose',
    'tools',
    'answer',
  ]);

  const prose = page.getByTestId('assistant-prose');
  await expect(prose.nth(0)).toContainText(MOCK_INTERLEAVE_PROSE_ONE);
  await expect(prose.nth(1)).toContainText(MOCK_INTERLEAVE_PROSE_TWO);

  const reasoning = page.getByTestId('reasoning-block');
  await reasoning.nth(0).getByRole('button').click();
  await expect(reasoning.nth(0)).toContainText(MOCK_INTERLEAVE_REASONING_ONE);
  await reasoning.nth(1).getByRole('button').click();
  await expect(reasoning.nth(1)).toContainText(MOCK_INTERLEAVE_REASONING_TWO);
});
