import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_PROMPTS,
  SUBAGENT_TOOL,
  SUBAGENT_TYPES,
  buildSubagentMessage,
  parseNotetakerFacts,
} from './subagents';

describe('subagent prompts', () => {
  it('has one expanded prompt per type', () => {
    for (const type of SUBAGENT_TYPES) {
      const prompt = SUBAGENT_PROMPTS[type];
      expect(prompt.length).toBeGreaterThan(600);
      expect(prompt.length).toBeLessThan(6000);
    }
    expect(SUBAGENT_PROMPTS.explorer).toContain('file:line');
    expect(SUBAGENT_PROMPTS.reviewer).toContain('VERDICT:');
    expect(SUBAGENT_PROMPTS.notetaker).toContain('"facts"');
    expect(SUBAGENT_PROMPTS.worker).toContain('worktree');
    expect(SUBAGENT_PROMPTS.planner).toContain('"tasks"');
  });

  it('gives every prompt an operating loop, an evidence contract, and a failure contract', () => {
    for (const type of SUBAGENT_TYPES) {
      const prompt = SUBAGENT_PROMPTS[type];
      expect(prompt, type).toContain('Operating loop');
      expect(prompt, type).toContain('Evidence');
      expect(prompt, type).toContain('Blocker');
      expect(prompt, type).toContain('file:line');
      expect(prompt, type).toMatch(/stop and report|Stop and report/);
    }
  });

  it('keeps the explorer read-only and the reviewer non-editing', () => {
    expect(SUBAGENT_PROMPTS.explorer).toContain('never edit files');
    expect(SUBAGENT_PROMPTS.explorer).toContain('never run a command that writes to disk');
    expect(SUBAGENT_PROMPTS.reviewer).toContain('do not edit files');
    expect(SUBAGENT_PROMPTS.reviewer).toContain('nine points');
  });

  it('gives every prompt the blocked protocol', () => {
    for (const type of SUBAGENT_TYPES) {
      const prompt = SUBAGENT_PROMPTS[type];
      expect(prompt, type).toContain(
        'The task below is all you see; there is no conversation history.',
      );
      expect(prompt, type).toContain(
        'return exactly BLOCKED: <the one missing input> and stop. Do not guess.',
      );
    }
  });

  it('adds the role specific rules to each prompt', () => {
    expect(SUBAGENT_PROMPTS.explorer).toContain('the searches that returned nothing');
    expect(SUBAGENT_PROMPTS.reviewer).toContain("Review the diff, not the author's summary");
    expect(SUBAGENT_PROMPTS.reviewer).toContain('read every changed file yourself');
    expect(SUBAGENT_PROMPTS.reviewer).toContain('return both citations');
    expect(SUBAGENT_PROMPTS.notetaker).toContain('supersedes fact');
    expect(SUBAGENT_PROMPTS.notetaker).toContain('State the platform');
    expect(SUBAGENT_PROMPTS.worker).toContain('the brief contradicts the repository');
    expect(SUBAGENT_PROMPTS.worker).toContain('exact acceptance command');
    expect(SUBAGENT_PROMPTS.planner).toContain('exact command that proves the task');
    expect(SUBAGENT_PROMPTS.planner).toContain('not "tests pass"');
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

  it('describes the subagent tool with its actions and spawn fields', () => {
    expect(SUBAGENT_TOOL.name).toBe('subagent');
    expect(Object.keys(SUBAGENT_TOOL.parameters.properties)).toEqual([
      'action',
      'id',
      'text',
      'timeout_s',
      'type',
      'task',
      'model',
    ]);
    expect(SUBAGENT_TOOL.parameters.required).toEqual([]);
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
