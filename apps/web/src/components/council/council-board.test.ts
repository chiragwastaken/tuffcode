import type { Goal, Review, Task, TaskState } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  TASK_HEIGHT,
  TASK_WIDTH,
  boardLayoutFromStatus,
  clampZoom,
  edgePath,
  fitViewport,
  goalStateColor,
  layoutCouncilBoard,
  reviewerChipLabel,
  reviewerLabel,
  taskDepths,
  taskStateColor,
  type BoardNode,
} from './council-board';

const at = '2026-01-01T00:00:00.000Z';

function task(title: string, dependsOn: string[] = [], state: TaskState = 'queued'): Task {
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
    reviewerProvider: null,
    reviewerModel: null,
    critical: false,
    round: 0,
    error: null,
    createdAt: at,
    updatedAt: at,
  };
}

function goal(state: Goal['state'] = 'running'): Goal {
  return {
    id: 'gol_1',
    threadId: 'thr_root',
    text: 'Ship it',
    autonomy: 'manual',
    state,
    createdAt: at,
    reportedAt: null,
  };
}

function review(taskId: string, verdict: Review['verdict']): Review {
  return {
    id: `rev_${taskId}_${verdict}`,
    taskId,
    providerId: 'prov_1',
    modelId: 'reviewer-1',
    verdict,
    body: 'body',
    createdAt: at,
  };
}

function nodeById(nodes: readonly BoardNode[], id: string): BoardNode {
  const node = nodes.find((entry) => entry.id === id);
  if (node === undefined) throw new Error(`missing node ${id}`);
  return node;
}

describe('taskDepths', () => {
  it('walks the longest dependency chain', () => {
    const tasks = [task('A'), task('B', ['A']), task('C', ['A', 'B']), task('D', ['C']), task('E')];
    const depths = taskDepths(tasks);
    expect(depths.get('tsk_A')).toBe(0);
    expect(depths.get('tsk_B')).toBe(1);
    expect(depths.get('tsk_C')).toBe(2);
    expect(depths.get('tsk_D')).toBe(3);
    expect(depths.get('tsk_E')).toBe(0);
  });

  it('matches dependency titles case-insensitively and ignores unknown ones', () => {
    const depths = taskDepths([task('First'), task('Second', ['first', 'Ghost'])]);
    expect(depths.get('tsk_Second')).toBe(1);
  });

  it('terminates on a cycle instead of recursing forever', () => {
    const depths = taskDepths([task('A', ['B']), task('B', ['A'])]);
    for (const depth of depths.values()) expect(Number.isInteger(depth)).toBe(true);
    expect(depths.size).toBe(2);
  });
});

describe('layoutCouncilBoard', () => {
  const tasks = [task('Plan schema'), task('Build api', ['Plan schema']), task('Build ui')];

  it('puts the planner on top and each task in a column by depth', () => {
    const layout = layoutCouncilBoard(goal(), tasks, []);
    const planner = nodeById(layout.nodes, 'planner');
    expect(planner.y).toBeLessThan(nodeById(layout.nodes, 'task:tsk_Plan schema').y);

    const schema = nodeById(layout.nodes, 'task:tsk_Plan schema');
    const api = nodeById(layout.nodes, 'task:tsk_Build api');
    const ui = nodeById(layout.nodes, 'task:tsk_Build ui');
    expect(schema.x).toBe(ui.x);
    expect(api.x).toBeGreaterThan(schema.x);
    expect(api.column).toBe(1);
    expect(schema.column).toBe(0);
    expect(layout.columns).toBe(2);
  });

  it('attaches a reviewer under every task', () => {
    const layout = layoutCouncilBoard(goal(), tasks, []);
    for (const entry of tasks) {
      const node = nodeById(layout.nodes, `task:${entry.id}`);
      const reviewer = nodeById(layout.nodes, `reviewer:${entry.id}`);
      expect(reviewer.x).toBe(node.x);
      expect(reviewer.y).toBe(node.y + TASK_HEIGHT + 6);
      expect(reviewer.width).toBe(TASK_WIDTH);
      expect(layout.edges.some((edge) => edge.id === `review:${entry.id}`)).toBe(true);
    }
  });

  it('puts the report in the column after the last task column', () => {
    const layout = layoutCouncilBoard(goal(), tasks, []);
    const api = nodeById(layout.nodes, 'task:tsk_Build api');
    const report = nodeById(layout.nodes, 'report');
    expect(report.x).toBeGreaterThan(api.x);
    expect(report.column).toBe(2);
  });

  it('draws plan edges to roots, dependency edges and review edges', () => {
    const layout = layoutCouncilBoard(goal(), tasks, []);
    const planRoots = layout.edges.filter((edge) => edge.kind === 'plan').map((edge) => edge.to);
    expect(planRoots).toEqual(['task:tsk_Build ui', 'task:tsk_Plan schema']);
    const depends = layout.edges.filter((edge) => edge.kind === 'depends');
    expect(depends).toHaveLength(1);
    expect(depends[0]?.from).toBe('task:tsk_Plan schema');
    expect(depends[0]?.to).toBe('task:tsk_Build api');
  });

  it('is deterministic regardless of the order tasks arrive in', () => {
    const forward = layoutCouncilBoard(goal(), tasks, []);
    const shuffled = layoutCouncilBoard(goal(), [tasks[2]!, tasks[0]!, tasks[1]!], []);
    expect(shuffled.nodes).toEqual(forward.nodes);
    expect(shuffled.edges).toEqual(forward.edges);
    expect(shuffled.width).toBe(forward.width);
    expect(shuffled.height).toBe(forward.height);
  });

  it('sorts rows inside a column by title', () => {
    const layout = layoutCouncilBoard(goal(), [task('Zebra'), task('Alpha')], []);
    expect(nodeById(layout.nodes, 'task:tsk_Alpha').y).toBeLessThan(
      nodeById(layout.nodes, 'task:tsk_Zebra').y,
    );
  });

  it('lays out the empty board with planner, report and one edge', () => {
    const layout = boardLayoutFromStatus(null);
    expect(layout.nodes.map((node) => node.kind)).toEqual(['planner', 'report']);
    expect(layout.edges).toHaveLength(1);
    expect(layout.columns).toBe(0);
  });

  it('shows the latest reviewer verdict on the reviewer node', () => {
    const layout = layoutCouncilBoard(goal(), tasks, [
      review('tsk_Build api', 'changes-requested'),
      review('tsk_Build api', 'pass'),
    ]);
    const reviewer = nodeById(layout.nodes, 'reviewer:tsk_Build api');
    expect(reviewer.verdict).toBe('pass');
    expect(reviewer.title).toBe('Build api');
    expect(reviewerLabel(reviewer)).toBe('Pass');
    expect(reviewerChipLabel(reviewer)).toBe('Pass');
  });

  it('shortens a changes-requested verdict for the reviewer chip', () => {
    const layout = layoutCouncilBoard(goal(), tasks, [review('tsk_Build ui', 'changes-requested')]);
    expect(reviewerChipLabel(nodeById(layout.nodes, 'reviewer:tsk_Build ui'))).toBe('Changes');
  });

  it('labels a reviewer with no verdict from the task state', () => {
    const layout = layoutCouncilBoard(goal(), [task('A', [], 'reviewing')], []);
    expect(reviewerLabel(nodeById(layout.nodes, 'reviewer:tsk_A'))).toBe('Reviewing');
  });
});

describe('status colors', () => {
  it('maps every required task state onto a semantic token', () => {
    expect(taskStateColor('queued')).toBe('var(--muted-foreground)');
    expect(taskStateColor('running')).toBe('var(--primary)');
    expect(taskStateColor('blocked')).toBe('var(--warning)');
    expect(taskStateColor('pr-open')).toBe('var(--info)');
    expect(taskStateColor('reviewing')).toBe('var(--info)');
    expect(taskStateColor('passed')).toBe('var(--success)');
    expect(taskStateColor('merged')).toBe('var(--success)');
    expect(taskStateColor('awaiting-captain')).toBe('var(--warning)');
    expect(taskStateColor('failed')).toBe('var(--error)');
  });

  it('keeps every task state and goal state on a token', () => {
    const states: TaskState[] = [
      'queued',
      'provisioning',
      'running',
      'blocked',
      'pr-open',
      'reviewing',
      'changes-requested',
      'passed',
      'merged',
      'awaiting-captain',
      'failed',
      'cancelled',
    ];
    for (const state of states) expect(taskStateColor(state)).toMatch(/^var\(--/);
    expect(goalStateColor('done')).toBe('var(--success)');
    expect(goalStateColor('failed')).toBe('var(--error)');
    expect(goalStateColor('planning')).toBe('var(--info)');
  });
});

describe('edgePath', () => {
  it('starts and ends at the anchors', () => {
    const path = edgePath({ x: 10, y: 20 }, { x: 210, y: 60 });
    expect(path.startsWith('M 10 20 C ')).toBe(true);
    expect(path.endsWith(', 210 60')).toBe(true);
  });

  it('bows sideways for horizontal pairs and up or down for vertical pairs', () => {
    const horizontal = edgePath({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(horizontal).toBe('M 0 0 C 50 0, 50 10, 100 10');
    const vertical = edgePath({ x: 0, y: 0 }, { x: 4, y: 100 });
    expect(vertical).toBe('M 0 0 C 0 50, 4 50, 4 100');
  });

  it('keeps a minimum reach on short hops', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe('M 0 0 C 24 0, -20 0, 4 0');
  });
});

describe('viewport', () => {
  it('clamps zoom to the board range', () => {
    expect(clampZoom(0.01)).toBe(0.35);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('fits a wide board inside a narrow viewport and centers it', () => {
    const viewport = fitViewport({ width: 800, height: 400 }, { width: 400, height: 300 });
    expect(viewport.scale).toBeCloseTo(0.46);
    expect(viewport.x).toBeCloseTo(16);
    expect(viewport.y).toBeGreaterThan(0);
  });

  it('never enlarges past 1:1', () => {
    expect(fitViewport({ width: 100, height: 80 }, { width: 400, height: 300 }).scale).toBe(1);
  });
});
