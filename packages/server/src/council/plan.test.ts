import { describe, expect, it } from 'vitest';
import { parsePlan, pathsOverlap, validatePlan } from './plan.js';

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Task one',
    files: ['src/one.ts'],
    dependsOn: [],
    critical: false,
    brief: 'Do the thing.',
    ...overrides,
  };
}

describe('validatePlan', () => {
  it('accepts a plan with unique titles and acyclic dependencies', () => {
    const plan = validatePlan({
      tasks: [
        task({ title: 'First', files: ['src/first.ts'] }),
        task({ title: 'Second', files: ['src/second.ts'], dependsOn: ['First'] }),
      ],
      question: null,
    });
    expect(plan.tasks.map((entry) => entry.title)).toEqual(['First', 'Second']);
    expect(plan.tasks[1]?.dependsOn).toEqual(['First']);
  });

  it('rejects duplicate titles regardless of case', () => {
    expect(() =>
      validatePlan({
        tasks: [task({ title: 'Same', files: ['a.ts'] }), task({ title: 'same', files: ['b.ts'] })],
      }),
    ).toThrow(/duplicate task title/i);
  });

  it('rejects two tasks owning the same file', () => {
    expect(() =>
      validatePlan({
        tasks: [
          task({ title: 'One', files: ['src/shared.ts'] }),
          task({ title: 'Two', files: ['src\\shared.ts'] }),
        ],
      }),
    ).toThrow(/file ownership overlaps/i);
  });

  it('rejects a directory that contains another task file', () => {
    expect(() =>
      validatePlan({
        tasks: [
          task({ title: 'One', files: ['src/components'] }),
          task({ title: 'Two', files: ['src/components/button.tsx'] }),
        ],
      }),
    ).toThrow(/file ownership overlaps/i);
  });

  it('rejects a dependency cycle', () => {
    expect(() =>
      validatePlan({
        tasks: [
          task({ title: 'A', files: ['a.ts'], dependsOn: ['B'] }),
          task({ title: 'B', files: ['b.ts'], dependsOn: ['A'] }),
        ],
      }),
    ).toThrow(/dependency cycle/i);
  });

  it('rejects a self dependency', () => {
    expect(() =>
      validatePlan({ tasks: [task({ title: 'A', files: ['a.ts'], dependsOn: ['A'] })] }),
    ).toThrow(/depends on itself/i);
  });

  it('rejects an unknown dependency', () => {
    expect(() => validatePlan({ tasks: [task({ title: 'A', dependsOn: ['Ghost'] })] })).toThrow(
      /unknown task "Ghost"/i,
    );
  });

  it('rejects more than twelve tasks', () => {
    const tasks = Array.from({ length: 13 }, (_, index) =>
      task({ title: `Task ${index}`, files: [`src/${index}.ts`] }),
    );
    expect(() => validatePlan({ tasks })).toThrow(/cap is 12/i);
  });

  it('rejects a plan with no tasks and no question', () => {
    expect(() => validatePlan({ tasks: [] })).toThrow(/no tasks and no question/i);
  });

  it('accepts a planner question only with an empty task list', () => {
    expect(validatePlan({ tasks: [], question: 'Which database?' })).toEqual({
      tasks: [],
      question: 'Which database?',
    });
    expect(() => validatePlan({ tasks: [task()], question: 'Which database?' })).toThrow(
      /only allowed when tasks is empty/i,
    );
  });

  it('rejects an empty file list and an empty brief', () => {
    expect(() => validatePlan({ tasks: [task({ files: [] })] })).toThrow(/at least one file/i);
    expect(() => validatePlan({ tasks: [task({ brief: '  ' })] })).toThrow(/brief/i);
  });

  it('canonicalizes dependency titles to their task spelling', () => {
    const plan = validatePlan({
      tasks: [
        task({ title: 'First', files: ['a.ts'] }),
        task({ title: 'Second', files: ['b.ts'], dependsOn: ['first'] }),
      ],
    });
    expect(plan.tasks[1]?.dependsOn).toEqual(['First']);
  });
});

describe('parsePlan', () => {
  it('extracts JSON from prose and a code fence', () => {
    const plan = parsePlan(
      'Here is the plan:\n```json\n{"tasks":[{"title":"A","files":["a.ts"],"dependsOn":[],"critical":false,"brief":"Do it."}],"question":null}\n```\n',
    );
    expect(plan.tasks).toHaveLength(1);
  });

  it('rejects a reply without JSON', () => {
    expect(() => parsePlan('I cannot plan this.')).toThrow(/did not return a JSON object/i);
  });

  it('rejects malformed JSON', () => {
    expect(() => parsePlan('{"tasks": [}')).toThrow(/invalid JSON/i);
  });
});

describe('pathsOverlap', () => {
  it('matches equal paths, separators, and nested directories', () => {
    expect(pathsOverlap('src/a.ts', 'src\\a.ts')).toBe(true);
    expect(pathsOverlap('src', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/a.ts', 'src/a.tsx')).toBe(false);
  });
});
