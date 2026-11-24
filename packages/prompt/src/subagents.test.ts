import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_PROMPTS,
  SUBAGENT_TOOL,
  SUBAGENT_TYPES,
  buildSubagentMessage,
  parseNotetakerFacts,
} from './subagents';

describe('subagent prompts', () => {
  it('has one compact prompt per type', () => {
    for (const type of SUBAGENT_TYPES) {
      const prompt = SUBAGENT_PROMPTS[type];
      expect(prompt.length).toBeGreaterThan(200);
      expect(prompt.length).toBeLessThan(4000);
    }
    expect(SUBAGENT_PROMPTS.explorer).toContain('file:line');
    expect(SUBAGENT_PROMPTS.reviewer).toContain('VERDICT:');
    expect(SUBAGENT_PROMPTS.notetaker).toContain('"facts"');
    expect(SUBAGENT_PROMPTS.worker).toContain('worktree');
    expect(SUBAGENT_PROMPTS.planner).toContain('"tasks"');
  });

  it('puts the role prompt before the task and a bounded context block', () => {
    const message = buildSubagentMessage({
      type: 'explorer',
      task: 'Map the runner',
      cwd: 'C:/worktrees/x',
      projectName: 'Demo',
      parentTitle: 'Parent',
    });
    expect(message.startsWith(SUBAGENT_PROMPTS.explorer)).toBe(true);
    expect(message).toContain('TASK\nMap the runner');
    expect(message).toContain('project: Demo');
    expect(message).toContain('cwd: C:/worktrees/x');
    expect(message).toContain('parent thread: Parent');
  });

  it('describes the subagent tool with the three documented fields', () => {
    expect(SUBAGENT_TOOL.name).toBe('subagent');
    expect(Object.keys(SUBAGENT_TOOL.parameters.properties)).toEqual(['type', 'task', 'model']);
    expect(SUBAGENT_TOOL.parameters.required).toEqual(['type', 'task']);
  });
});

describe('parseNotetakerFacts', () => {
  it('reads facts out of prose and clamps them', () => {
    const facts = parseNotetakerFacts(
      'Here you go:\n```json\n{"facts":[{"text":"  Two   spaces  ","tags":"A, b","importance":2}]}\n```',
    );
    expect(facts).toEqual([{ text: 'Two spaces', tags: 'a,b', importance: 1 }]);
  });

  it('returns nothing for malformed or empty answers', () => {
    expect(parseNotetakerFacts('no json here')).toEqual([]);
    expect(parseNotetakerFacts('{"facts":"nope"}')).toEqual([]);
    expect(parseNotetakerFacts('{"facts":[]}')).toEqual([]);
  });

  it('caps the list at eight facts', () => {
    const facts = Array.from({ length: 12 }, (_, index) => ({ text: `fact ${index}` }));
    expect(parseNotetakerFacts(JSON.stringify({ facts }))).toHaveLength(8);
  });
});
