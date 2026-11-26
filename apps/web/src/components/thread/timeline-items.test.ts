import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StepsRow } from './timeline-items';
import type { ReasoningBlock, StepsBlock, ToolGroupBlock } from './turn-blocks';

const theme = {} as never;

const reasoning: ReasoningBlock = {
  kind: 'reasoning',
  key: 'reasoning-turn-1-0',
  turnId: 'turn-1',
  text: 'Plan',
  streaming: false,
  durationMs: 12_000,
};

const tools: ToolGroupBlock = {
  kind: 'tools',
  key: 'tools-tool-a',
  turnId: 'turn-1',
  durationMs: 1000,
  tools: [
    {
      kind: 'tool',
      key: 'tool-a',
      turnId: 'turn-1',
      toolCallId: 'a',
      name: 'read',
      input: { path: 'a.ts' },
      output: 'ok',
      isError: false,
      running: false,
      startedAt: null,
      finishedAt: null,
    },
    {
      kind: 'tool',
      key: 'tool-b',
      turnId: 'turn-1',
      toolCallId: 'b',
      name: 'bash',
      input: { command: 'pnpm test' },
      output: 'passed',
      isError: false,
      running: false,
      startedAt: null,
      finishedAt: null,
    },
  ],
};

function steps(overrides: Partial<StepsBlock> = {}): StepsBlock {
  return {
    kind: 'steps',
    key: 'steps-turn-1',
    turnId: 'turn-1',
    tools: 2,
    durationMs: 12_000,
    children: [reasoning, tools],
    ...overrides,
  };
}

function render(block: StepsBlock): string {
  return renderToStaticMarkup(createElement(StepsRow, { block, theme }));
}

describe('StepsRow', () => {
  it('renders one collapsed row with the summary label and no body', () => {
    const html = render(steps());
    expect(html).toContain('Ran 2 tools and thought for 12s');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="steps-block"');
    expect(html).not.toContain('data-testid="steps-body"');
    expect(html).not.toContain('Read a.ts');
  });

  it('labels a single tool with no measured thought', () => {
    const html = render(steps({ tools: 1, durationMs: null, children: [tools] }));
    expect(html).toContain('Ran 1 tool');
    expect(html).not.toContain('thought for');
  });
});
