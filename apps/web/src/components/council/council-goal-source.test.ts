import type { Goal, Review, Task, TaskState } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { boardLayoutFromStatus } from './council-board';
import { goalIdFromLatest, type LatestCouncil } from './council-goal-source';

const at = '2026-01-01T00:00:00.000Z';

function task(title: string, dependsOn: string[], state: TaskState): Task {
  return {
    id: `tsk_${title}`,
    goalId: 'gol_1',
    threadId: `thr_${title}`,
    title,
    brief: `Do ${title}.`,
    dependsOn,
    state,
    authorProvider: 'p1',
    authorModel: 'model-1',
    reviewerProvider: 'p2',
    reviewerModel: 'reviewer-1',
    critical: false,
    round: 1,
    error: null,
    createdAt: at,
    updatedAt: at,
  };
}

function review(taskId: string, verdict: Review['verdict']): Review {
  return {
    id: `rev_${taskId}`,
    taskId,
    providerId: 'prov_2',
    modelId: 'reviewer-1',
    verdict,
    body: 'body',
    createdAt: at,
  };
}

function goal(state: Goal['state'] = 'reviewing'): Goal {
  return {
    id: 'gol_1',
    threadId: 'thr_goal',
    text: 'Add a CSV export',
    autonomy: 'auto',
    state,
    createdAt: at,
    reportedAt: null,
  };
}

/** What the server returns after a reload: the thread's newest goal, fully hydrated. */
function seededLatest(): LatestCouncil {
  const tasks = [
    task('Export builder', [], 'merged'),
    task('Download button', ['Export builder'], 'running'),
    task('Changelog', ['Export builder'], 'reviewing'),
  ];
  return {
    goal: goal(),
    tasks,
    reviews: [review(tasks[0]!.id, 'pass'), review(tasks[2]!.id, 'changes-requested')],
  };
}

describe('goalIdFromLatest', () => {
  it('follows the newest goal the server reports', () => {
    expect(goalIdFromLatest(seededLatest(), null)).toBe('gol_1');
  });

  it('has no goal when the thread never ran one', () => {
    expect(goalIdFromLatest(null, null)).toBeNull();
  });

  it('keeps a dismissed goal hidden until a different goal arrives', () => {
    expect(goalIdFromLatest(seededLatest(), 'gol_1')).toBeNull();
    expect(goalIdFromLatest(seededLatest(), 'gol_other')).toBe('gol_1');
  });
});

describe('reload with a seeded goal', () => {
  it('lays the fetched goal out as a board with tasks, reviewers and edges', () => {
    const latest = seededLatest();
    const goalId = goalIdFromLatest(latest, null);
    expect(goalId).toBe('gol_1');

    // The panel then reads council.status for that id; latest carries the same shape.
    const layout = boardLayoutFromStatus(latest);
    const kinds = layout.nodes.map((node) => node.kind);
    expect(kinds.filter((kind) => kind === 'task')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'reviewer')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'planner')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'report')).toHaveLength(1);
    expect(layout.columns).toBe(2);
    expect(layout.edges.filter((edge) => edge.kind === 'depends')).toHaveLength(2);
    expect(layout.edges.filter((edge) => edge.kind === 'plan')).toHaveLength(1);
  });

  it('shows the empty board when the lookup returns nothing', () => {
    expect(goalIdFromLatest(null, null)).toBeNull();
    const layout = boardLayoutFromStatus(null);
    expect(layout.nodes.map((node) => node.kind)).toEqual(['planner', 'report']);
  });
});
