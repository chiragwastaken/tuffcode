import { describe, expect, it } from 'vitest';
import { THINKING_BUDGETS, thinkingBudget } from './anthropic/client.js';
import { claudeEffort } from './claude/adapter.js';
import { codexEffort } from './codex/adapter.js';
import { reasoningParams } from './openai/client.js';

describe('reasoning effort mapping', () => {
  it('sends reasoning_effort to compatible servers and a reasoning object to OpenRouter', () => {
    expect(reasoningParams('https://api.openai.com/v1', 'xhigh')).toEqual({
      reasoning_effort: 'xhigh',
    });
    expect(reasoningParams('https://openrouter.ai/api/v1', 'high')).toEqual({
      reasoning: { effort: 'high' },
    });
    expect(reasoningParams('http://localhost:11434/v1', undefined)).toEqual({});
    expect(reasoningParams('http://localhost:11434/v1', '  ')).toEqual({});
  });

  it('maps levels to Anthropic thinking budgets and leaves none off', () => {
    expect(thinkingBudget('high')).toBe(24000);
    expect(thinkingBudget('xhigh')).toBe(48000);
    expect(thinkingBudget('none')).toBeNull();
    expect(thinkingBudget('turbo')).toBeNull();
    expect(thinkingBudget(undefined)).toBeNull();
    expect(Object.keys(THINKING_BUDGETS)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('keeps Claude and Codex on the levels their runtimes accept', () => {
    expect(claudeEffort('max')).toEqual({ effort: 'max' });
    expect(claudeEffort('minimal')).toEqual({ effort: 'low' });
    expect(claudeEffort('none')).toEqual({});
    expect(codexEffort('xhigh')).toEqual({ effort: 'xhigh' });
    expect(codexEffort('max')).toEqual({});
  });
});
