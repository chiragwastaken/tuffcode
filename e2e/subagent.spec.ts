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
  MOCK_SUBAGENT_FINAL,
  MOCK_SUBAGENT_TASK,
  MOCK_SUBAGENT_TWO_TASK,
  MOCK_TEXT,
} from './mock-openai';

test('spawns a child, shows its card under the spawn turn, and opens the pane', async ({
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
  // The spec's two-pane view: thread plus subagent pane, no inspector competing
  // for the right side. The overlay case is asserted at the end.
  await page.getByRole('button', { name: 'Hide inspector' }).click();

  await sendMessage(page, 'spawn-subagent');
  await expectAssistantText(page, MOCK_SUBAGENT_FINAL);

  // Closed pane: one compact strip that names the running child.
  const strip = page.getByTestId('subagent-strip');
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId('subagent-strip-label')).toContainText(/1 subagent/);
  await expect(strip.getByTestId('subagent-strip-type-explorer')).toBeVisible();

  await strip.click();

  const pane = page.getByTestId('subagent-pane');
  await expect(pane).toBeVisible();
  const header = page.getByTestId('subagent-pane-header');
  await expect(header).toContainText('Explorer');
  await expect(page.getByTestId('subagent-pane-model')).toContainText('mock-model');

  // The card stays in the parent timeline, attributed to the turn that spawned it,
  // and the connector line runs from that card to the pane header.
  const group = page.getByTestId('subagent-group').first();
  await expect(group).toContainText('Turn 1');
  const card = group.getByTestId('subagent-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-active', 'true');

  const connector = page.getByTestId('subagent-connector');
  await expect(connector).toBeVisible();
  await expect(connector).toHaveAttribute('data-connector-d', /^M -?\d/);

  await expect(page.getByTestId('subagent-task')).toContainText(MOCK_SUBAGENT_TASK);

  // The child runs the same mock provider, so its own turn renders in the pane.
  await expect(page.getByTestId('subagent-timeline')).toContainText(MOCK_TEXT);
  await expect(page.getByTestId('subagent-pane-status')).toHaveAttribute('data-status', 'done');

  const shots = process.env['TUFFCODE_E2E_SHOTS'];
  const prefix = process.env['TUFFCODE_E2E_SHOT_PREFIX'] ?? 'subagent';
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${prefix}-pane.png`) });
  }

  // Reopening the inspector narrows the thread row below the pane's split width, so
  // the pane becomes a sheet and the connector re-anchors to its edge.
  await page.getByRole('button', { name: 'Show inspector' }).click();
  await expect(page.getByTestId('inspector-header')).toBeVisible();
  await expect(page.getByTestId('subagent-pane')).toBeVisible();
  await expect(page.getByTestId('subagent-connector')).toHaveAttribute(
    'data-connector-d',
    /^M -?\d/,
  );
  if (shots) {
    await page.screenshot({ path: join(shots, `${prefix}-pane-narrow.png`) });
  }

  // A second child adds a tab; selecting it switches the pane header and task.
  await sendMessage(page, 'spawn-subagent-two');
  const tabs = page.getByTestId('subagent-tabs');
  await expect(tabs).toBeVisible();
  await expect(page.getByTestId('subagent-tab')).toHaveCount(2);

  await tabs.getByRole('tab', { name: /Reviewer/ }).click();
  await expect(header).toContainText('Reviewer');
  // Every child panel stays mounted for its scroll position, so assert on the
  // visible one rather than on a duplicated test id.
  await expect(page.getByTestId('subagent-task').locator('visible=true')).toContainText(
    MOCK_SUBAGENT_TWO_TASK,
  );

  // Closing the pane returns to the strip without losing either child.
  await page.getByTestId('subagent-pane-close').click();
  await expect(pane).toBeHidden();
  const closingStrip = page.getByTestId('subagent-strip');
  await expect(closingStrip).toBeVisible();
  await expect(closingStrip.getByTestId('subagent-strip-label')).toContainText(/2 subagents/);
});
