import { describe, expect, it } from 'vitest';
import {
  buildPlannerPrompt,
  buildReviewPrompt,
  buildRevisionBrief,
  buildWorkerBrief,
  parsePullRequestUrl,
  parseReviewVerdict,
} from './prompts.js';
import type { PlanTask } from './types.js';

const task: PlanTask = {
  title: 'Wire the widget',
  files: ['src/widget.ts'],
  dependsOn: [],
  critical: false,
  brief: 'Add the widget and test it.',
};

describe('buildPlannerPrompt', () => {
  it('carries the goal, project, and base branch', () => {
    const prompt = buildPlannerPrompt({
      goal: 'Ship widgets',
      projectName: 'Demo',
      projectPath: 'C:/demo',
      baseBranch: 'main',
    });
    expect(prompt).toContain('Ship widgets');
    expect(prompt).toContain('Demo at C:/demo');
    expect(prompt).toContain('main');
    expect(prompt).toContain('{"tasks":');
  });
});

describe('buildWorkerBrief', () => {
  it('fills every template placeholder and adds the council addendum', () => {
    const brief = buildWorkerBrief({
      task,
      goal: 'Ship widgets',
      goalId: 'gol_1',
      projectName: 'Demo',
      projectPath: 'C:/demo',
      baseBranch: 'main',
      worktreePath: 'C:/worktrees/thr_1',
      branch: 'tuffcode/thr_1',
      taskIndex: 0,
      taskCount: 2,
    });
    expect(brief).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(brief).toContain('Wire the widget');
    expect(brief).toContain('C:/worktrees/thr_1');
    expect(brief).toContain('tuffcode/thr_1');
    expect(brief).toContain('Task 1 of 2');
    expect(brief).toContain('do not run gh pr create');
  });
});

describe('buildReviewPrompt', () => {
  it('includes the brief, PR, worker report, and diff', () => {
    const prompt = buildReviewPrompt({
      task,
      prUrl: 'https://example.test/pull/7',
      workerReport: 'Tests pass.',
      patch: 'diff --git a/src/widget.ts b/src/widget.ts',
    });
    expect(prompt).toContain('VERDICT: pass | changes-requested | escalate');
    expect(prompt).toContain('https://example.test/pull/7');
    expect(prompt).toContain('Tests pass.');
    expect(prompt).toContain('diff --git');
  });

  it('marks an empty patch instead of sending an empty section', () => {
    const prompt = buildReviewPrompt({
      task,
      prUrl: 'https://example.test/pull/7',
      workerReport: 'Nothing.',
      patch: '   ',
    });
    expect(prompt).toContain('(no patch available)');
  });
});

describe('buildRevisionBrief', () => {
  it('names the round and repeats the findings', () => {
    const brief = buildRevisionBrief({ round: 2, findings: '1. Fix the null check.' });
    expect(brief).toContain('REVIEW ROUND 2');
    expect(brief).toContain('Fix the null check.');
  });
});

describe('parseReviewVerdict', () => {
  it('reads the verdict line regardless of case or spacing', () => {
    expect(parseReviewVerdict('VERDICT: pass\nFINDINGS: none')).toBe('pass');
    expect(parseReviewVerdict('  verdict :   changes-requested ')).toBe('changes-requested');
    expect(parseReviewVerdict('VERDICT: ESCALATE')).toBe('escalate');
  });

  it('escalates a reply without a valid verdict', () => {
    expect(parseReviewVerdict('Looks fine to me.')).toBe('escalate');
    expect(parseReviewVerdict('VERDICT: maybe')).toBe('escalate');
  });
});

describe('parsePullRequestUrl', () => {
  it('finds and trims a pull request URL', () => {
    expect(parsePullRequestUrl('Opened https://github.com/o/r/pull/42.')).toBe(
      'https://github.com/o/r/pull/42',
    );
    expect(parsePullRequestUrl('no link here')).toBeNull();
  });
});
