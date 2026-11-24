import { describe, expect, it } from 'vitest';

import {
  BASE_SYSTEM_PROMPT,
  COUNCIL_PLANNER_PROMPT,
  COUNCIL_REVIEWER_PROMPT,
  COUNCIL_WORKER_BRIEF_TEMPLATE,
  CUSTOM_INSTRUCTION_TOKEN_BUDGET,
  CUSTOM_INSTRUCTIONS_HEADING,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  assemblePrompt,
  buildCustomInstructions,
  buildSystemPrompt,
  buildTurnContext,
  estimateTokens,
} from './index';

declare const console: { log: (...args: unknown[]) => void };

const DASHES = /[\u2013\u2014]/;

const COUNCIL_HEADINGS = [
  'TASK',
  'ROLE',
  'PROJECT',
  'WORKTREE',
  'GOAL',
  'CONTEXT',
  'CONSTRAINTS',
  'DEFINITION OF DONE',
  'EVIDENCE',
  'REPORT BACK',
];

const REVIEW_POINTS = [
  'Scope',
  'Correctness',
  'Evidence',
  'Tests',
  'Secrets',
  'Validation',
  'Architecture',
  'Dead weight',
  'Criticality',
];

describe('base system prompt', () => {
  it('fits the token budget', () => {
    const tokens = estimateTokens(BASE_SYSTEM_PROMPT);
    console.log(`base system prompt: ${tokens} tokens (${BASE_SYSTEM_PROMPT.length} chars)`);
    expect(tokens).toBeGreaterThanOrEqual(600);
    expect(tokens).toBeLessThanOrEqual(900);
    expect(tokens).toBeLessThan(1000);
  });

  it('is ASCII only', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it('covers the required rules', () => {
    for (const phrase of [
      'Tuffcode',
      'Think before acting',
      'Read before you edit',
      'Batch independent tool calls',
      'Never fabricate output',
      'Stay in scope',
      'pwsh.exe',
      'ConPTY',
      'CRLF',
      '248 characters',
    ]) {
      expect(BASE_SYSTEM_PROMPT).toContain(phrase);
    }
  });
});

describe('tool schemas', () => {
  it('serializes under the token budget', () => {
    const serialized = JSON.stringify(TOOL_SCHEMAS);
    const tokens = estimateTokens(serialized);
    console.log(`tool schemas: ${tokens} tokens (${serialized.length} chars)`);
    expect(tokens).toBeLessThan(1600);
  });

  it('defines exactly the six harness tools', () => {
    expect(TOOL_SCHEMAS).toHaveLength(6);
    expect(TOOL_SCHEMAS.map((tool) => tool.name).toSorted()).toEqual([...TOOL_NAMES].toSorted());
  });

  it('keeps descriptions short and schemas valid', () => {
    for (const tool of TOOL_SCHEMAS) {
      expect(tool.description.trim().split(/\s+/).length).toBeLessThanOrEqual(40);
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required.length).toBeGreaterThan(0);
      for (const key of tool.parameters.required) {
        expect(tool.parameters.properties).toHaveProperty(key);
      }
      for (const property of Object.values(tool.parameters.properties)) {
        expect(['string', 'integer', 'boolean']).toContain(property.type);
      }
    }
  });

  it('declares the documented parameters', () => {
    const byName = new Map(TOOL_SCHEMAS.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.get('bash')?.parameters.properties ?? {})).toEqual([
      'command',
      'timeout_ms',
      'cwd',
    ]);
    expect(Object.keys(byName.get('read')?.parameters.properties ?? {})).toEqual([
      'path',
      'offset',
      'limit',
    ]);
    expect(Object.keys(byName.get('edit')?.parameters.properties ?? {})).toEqual([
      'path',
      'old_string',
      'new_string',
      'replace_all',
    ]);
    expect(Object.keys(byName.get('write')?.parameters.properties ?? {})).toEqual([
      'path',
      'content',
    ]);
    expect(Object.keys(byName.get('glob')?.parameters.properties ?? {})).toEqual([
      'pattern',
      'path',
    ]);
    expect(Object.keys(byName.get('grep')?.parameters.properties ?? {})).toEqual([
      'pattern',
      'path',
      'glob',
      'case_sensitive',
      'max_results',
    ]);
  });
});

describe('council prompts', () => {
  it('contains every worker brief heading', () => {
    for (const heading of COUNCIL_HEADINGS) {
      expect(COUNCIL_WORKER_BRIEF_TEMPLATE).toMatch(new RegExp(`^${heading}$`, 'm'));
    }
  });

  it('defines the nine review points and three verdicts', () => {
    for (const point of REVIEW_POINTS) {
      expect(COUNCIL_REVIEWER_PROMPT).toContain(point);
    }
    for (const verdict of ['pass', 'changes-requested', 'escalate']) {
      expect(COUNCIL_REVIEWER_PROMPT).toContain(verdict);
    }
  });

  it('keeps the planner machine readable', () => {
    expect(COUNCIL_PLANNER_PROMPT).toContain('"tasks"');
    expect(COUNCIL_PLANNER_PROMPT).toContain('"question"');
  });
});

describe('turn context', () => {
  const input = {
    date: '2026-11-24',
    mode: 'work' as const,
    cwd: 'D:\\tuffcode-wt\\prompt',
    brainSlice: 'User prefers pnpm. Windows host. No force pushes.',
    projectName: 'tuffcode',
  };

  it('renders a compact context block', () => {
    const block = buildTurnContext(input);
    const tokens = estimateTokens(block);
    console.log(`turn context: ${tokens} tokens (${block.length} chars)`);
    expect(tokens).toBeLessThan(200);
    expect(block.startsWith('<context>')).toBe(true);
    expect(block.endsWith('</context>')).toBe(true);
    expect(block).toContain('mode: work');
    expect(block).toContain('project: tuffcode');
  });

  it('stays under budget with a huge brain slice and path', () => {
    const block = buildTurnContext({
      ...input,
      cwd: `D:\\${'very-long-segment\\'.repeat(200)}`,
      brainSlice: `${'remember this. '.repeat(2000)}\nsecond line`,
    });
    expect(estimateTokens(block)).toBeLessThan(200);
    expect(block).not.toContain('\nsecond line');
  });

  it('omits the brain line when the slice is empty', () => {
    expect(buildTurnContext({ ...input, brainSlice: '   ' })).not.toContain('brain:');
  });

  it('estimates tokens at four characters each', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('buildSystemPrompt', () => {
  it('returns the base prompt without extra rules', () => {
    expect(buildSystemPrompt()).toBe(BASE_SYSTEM_PROMPT);
    expect(buildSystemPrompt({ extraRules: [] })).toBe(BASE_SYSTEM_PROMPT);
  });

  it('appends trimmed rules in order and skips blanks', () => {
    const prompt = buildSystemPrompt({
      extraRules: ['  never force push  ', '', '   ', 'use pnpm'],
    });
    expect(prompt).toContain('## Additional rules');
    expect(prompt).toContain('1. never force push');
    expect(prompt).toContain('2. use pnpm');
    expect(prompt.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);
  });
});

describe('custom instructions', () => {
  it('returns undefined for empty or whitespace-only text', () => {
    expect(buildCustomInstructions('')).toBeUndefined();
    expect(buildCustomInstructions('   \n\t ')).toBeUndefined();
  });

  it('trims and normalizes line endings without changing the text', () => {
    expect(buildCustomInstructions('  Prefer pnpm.\r\nNever force push.  ')).toBe(
      'Prefer pnpm.\nNever force push.',
    );
  });

  it('keeps text inside the budget untouched', () => {
    const text = 'Use pnpm for installs. '.repeat(40).trim();
    expect(estimateTokens(text)).toBeLessThanOrEqual(CUSTOM_INSTRUCTION_TOKEN_BUDGET);
    expect(buildCustomInstructions(text)).toBe(text);
  });

  it('caps at 300 tokens and cuts on a sentence boundary', () => {
    const sentence = 'Always run the narrow test before claiming a change works. ';
    const text = sentence.repeat(60);
    const capped = buildCustomInstructions(text);
    expect(capped).toBeDefined();
    expect(estimateTokens(capped ?? '')).toBeLessThanOrEqual(CUSTOM_INSTRUCTION_TOKEN_BUDGET);
    expect(capped?.endsWith('works.')).toBe(true);
    expect(text.startsWith(capped ?? '\u0000')).toBe(true);
  });

  it('falls back to a word boundary when the cap lands inside one long sentence', () => {
    const capped = buildCustomInstructions(`${'word '.repeat(400)}end`);
    expect(estimateTokens(capped ?? '')).toBeLessThanOrEqual(CUSTOM_INSTRUCTION_TOKEN_BUDGET);
    expect(capped?.endsWith('word')).toBe(true);
  });
});

describe('assemblePrompt', () => {
  const turnContext = {
    date: '2026-11-24',
    mode: 'work' as const,
    cwd: 'D:\\repo',
    projectName: 'demo',
    brainSlice: '',
  };

  it('orders base, custom instructions, brain, memory, context, then the user message', () => {
    const assembly = assemblePrompt({
      customInstructions: 'Prefer pnpm.',
      brainAlways: '- [rule] never force push',
      retrievedMemory: '- [memory] tests live in packages',
      turnContext,
      userMessage: 'run the tests',
    });

    expect(assembly.sections.map((entry) => entry.name)).toEqual([
      'base',
      'custom-instructions',
      'brain-always',
      'retrieved-memory',
      'turn-context',
      'user-message',
    ]);
    expect(assembly.sections[0]?.text).toBe(BASE_SYSTEM_PROMPT);
    expect(assembly.sections.at(-1)?.text).toBe('run the tests');

    const system = assembly.systemPrompt;
    expect(system.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);
    expect(system.indexOf(CUSTOM_INSTRUCTIONS_HEADING)).toBeLessThan(
      system.indexOf('never force push'),
    );
    expect(system.indexOf('never force push')).toBeLessThan(
      system.indexOf('tests live in packages'),
    );
    expect(system.indexOf('tests live in packages')).toBeLessThan(system.indexOf('<context>'));
    expect(system).not.toContain('run the tests');
    expect(assembly.total).toBe(assembly.sections.reduce((sum, entry) => sum + entry.tokens, 0));
  });

  it('omits empty custom instructions and empty brain blocks', () => {
    const assembly = assemblePrompt({
      customInstructions: '   ',
      brainAlways: '  ',
      retrievedMemory: '',
      turnContext,
      userMessage: 'hi',
    });
    expect(assembly.sections.map((entry) => entry.name)).toEqual([
      'base',
      'turn-context',
      'user-message',
    ]);
    expect(assembly.systemPrompt).not.toContain(CUSTOM_INSTRUCTIONS_HEADING);
  });

  it('counts every section at four characters per token', () => {
    const assembly = assemblePrompt({ turnContext, userMessage: 'abcd' });
    for (const entry of assembly.sections) {
      expect(entry.tokens).toBe(estimateTokens(entry.text));
    }
    expect(assembly.sections.at(-1)?.tokens).toBe(1);
  });
});

describe('character hygiene', () => {
  it('contains no em dash or en dash in any prompt or schema', () => {
    for (const text of [
      BASE_SYSTEM_PROMPT,
      COUNCIL_PLANNER_PROMPT,
      COUNCIL_WORKER_BRIEF_TEMPLATE,
      COUNCIL_REVIEWER_PROMPT,
      JSON.stringify(TOOL_SCHEMAS),
      buildSystemPrompt({ extraRules: ['plain rule'] }),
      buildTurnContext({
        date: '2026-11-24',
        mode: 'plan',
        cwd: 'C:\\repo',
        brainSlice: 'slice',
        projectName: 'demo',
      }),
    ]) {
      expect(text).not.toMatch(DASHES);
    }
  });
});
