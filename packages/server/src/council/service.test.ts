import type { ServerEvent, Thread } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import { createTestContext, silentLogger, type TestContext } from '../test-support.js';
import { createCouncil } from './service.js';
import type {
  ChildThreadRequest,
  Council,
  CouncilPorts,
  PullRequest,
  PullRequestRequest,
  RunTurnInput,
  TaskChanges,
  TurnResult,
} from './types.js';

type TurnHandler = (input: RunTurnInput, title: string) => Promise<TurnResult>;

function result(
  input: RunTurnInput,
  text: string,
  status: TurnResult['status'] = 'complete',
): TurnResult {
  return { threadId: input.threadId, turnId: 'turn_fake', status, text };
}

function planJson(
  tasks: readonly Record<string, unknown>[],
  question: string | null = null,
): string {
  return JSON.stringify({ tasks, question });
}

function planTask(
  title: string,
  files: string[],
  dependsOn: string[] = [],
): Record<string, unknown> {
  return { title, files, dependsOn, critical: false, brief: `Do ${title}.` };
}

const PASS_REVIEW = 'VERDICT: pass\nFINDINGS: none\nNOTES: ok';

class FakePorts implements CouncilPorts {
  readonly created: ChildThreadRequest[] = [];
  readonly turns: RunTurnInput[] = [];
  readonly deleted: string[] = [];
  readonly pullRequests: { threadId: string; title: string }[] = [];
  readonly titles = new Map<string, string>();
  changed = true;
  workerActive = 0;
  workerMax = 0;
  handler: TurnHandler;
  private watchers: { predicate: () => boolean; resolve: () => void }[] = [];

  constructor(private readonly ctx: TestContext) {
    this.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(input, planJson([planTask('Add widget', ['src/widget.ts'])])),
        );
      }
      if (title.startsWith('Review:')) return Promise.resolve(result(input, PASS_REVIEW));
      return Promise.resolve(result(input, 'worker done'));
    };
  }

  async createThread(request: ChildThreadRequest): Promise<Thread> {
    const id = `thr_child_${this.created.length + 1}`;
    this.created.push(request);
    this.titles.set(id, request.title);
    const now = new Date().toISOString();
    return this.ctx.repos.threads.create({
      id,
      projectId: request.projectId,
      parentThreadId: request.parentThreadId,
      title: request.title,
      providerId: request.providerId,
      modelId: request.modelId,
      executionMode: request.executionMode,
      permissionMode: request.permissionMode,
      status: 'idle',
      worktreePath: `C:/worktrees/${id}`,
      branch: `tuffcode/${id}`,
      baseBranch: request.baseBranch,
      createdAt: now,
      updatedAt: now,
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    this.deleted.push(threadId);
    this.ctx.repos.threads.remove(threadId);
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    this.turns.push(input);
    const title = this.titles.get(input.threadId) ?? '';
    const isWorker = title.startsWith('Council:');
    if (isWorker) {
      this.workerActive += 1;
      this.workerMax = Math.max(this.workerMax, this.workerActive);
      this.notify();
    }
    try {
      if (input.signal.aborted) return result(input, '', 'interrupted');
      return await this.handler(input, title);
    } finally {
      if (isWorker) this.workerActive -= 1;
    }
  }

  async openPullRequest(threadId: string, request: PullRequestRequest): Promise<PullRequest> {
    this.pullRequests.push({ threadId, title: request.title });
    const number = this.pullRequests.length;
    return { url: `https://example.test/pull/${number}`, number };
  }

  async changesForThread(): Promise<TaskChanges> {
    return this.changed
      ? {
          changed: true,
          files: ['src/widget.ts'],
          patch: 'diff --git a/src/widget.ts b/src/widget.ts',
        }
      : { changed: false, files: [], patch: '' };
  }

  workerTurns(): RunTurnInput[] {
    return this.turns.filter((turn) => this.titles.get(turn.threadId)?.startsWith('Council:'));
  }

  /** Resolves as soon as `predicate` holds, without polling the clock. */
  when(predicate: () => boolean): Promise<void> {
    if (predicate()) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.watchers.push({ predicate, resolve });
    return promise;
  }

  private notify(): void {
    for (const watcher of this.watchers.slice()) {
      if (!watcher.predicate()) continue;
      this.watchers = this.watchers.filter((entry) => entry !== watcher);
      watcher.resolve();
    }
  }
}

interface Harness {
  ctx: TestContext;
  council: Council;
  ports: FakePorts;
  events: ServerEvent[];
  disposed: string[];
  dispose(): Promise<void>;
}

function seedGoalThread(ctx: TestContext): Thread {
  const now = new Date().toISOString();
  ctx.repos.projects.add({
    id: 'prj_1',
    name: 'Demo',
    path: 'C:/demo',
    defaultBranch: 'main',
    createdAt: now,
  });
  ctx.repos.providers.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });
  ctx.repos.providers.upsert({ id: 'prv_codex', kind: 'codex', label: 'Codex', config: {} });
  ctx.repos.providers.replaceModels('prv_codex', [
    { modelId: 'gpt-x', label: 'GPT', contextWindow: null, isDefault: true },
  ]);
  return ctx.repos.threads.create({
    id: 'thr_goal',
    projectId: 'prj_1',
    parentThreadId: null,
    title: 'Goal thread',
    providerId: 'prv_claude',
    modelId: 'claude-x',
    executionMode: 'council',
    permissionMode: 'full-auto',
    status: 'idle',
    worktreePath: 'C:/demo',
    branch: 'main',
    baseBranch: 'main',
    createdAt: now,
    updatedAt: now,
  });
}

function fakeRunner(disposed: string[]): Runner {
  return {
    listActive: () => [],
    send: async () => ({ turnId: 'turn_unused' }),
    interrupt: async () => undefined,
    approve: async () => undefined,
    disposeThread: async (threadId) => {
      disposed.push(threadId);
    },
    disposeAll: async () => undefined,
    recoverOrphanedRuns: () => undefined,
  };
}

function createHarness(): Harness {
  const ctx = createTestContext();
  seedGoalThread(ctx);
  const bus = createEventBus();
  const events: ServerEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const disposed: string[] = [];
  const ports = new FakePorts(ctx);
  const council = createCouncil({
    repos: ctx.repos,
    bus,
    runner: fakeRunner(disposed),
    logger: silentLogger(),
    ports,
  });
  return {
    ctx,
    council,
    ports,
    events,
    disposed,
    dispose: async () => {
      await council.dispose();
      ctx.dispose();
    },
  };
}

interface Gate {
  wait(signal: AbortSignal): Promise<void>;
  open(): void;
}

function makeGate(): Gate {
  let opened = false;
  const waiters: (() => void)[] = [];
  return {
    open() {
      opened = true;
      for (const waiter of waiters.splice(0)) waiter();
    },
    wait(signal: AbortSignal) {
      if (opened || signal.aborted) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      const done = (): void => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      waiters.push(done);
      signal.addEventListener('abort', done, { once: true });
      return promise;
    },
  };
}

async function startGoal(harness: Harness, goal = 'Ship the widget'): Promise<string> {
  const { goalId } = await harness.council.start({
    threadId: 'thr_goal',
    goal,
    autonomy: 'auto',
  });
  return goalId;
}

describe('council goal lifecycle', () => {
  it('plans, runs a worker, opens a PR, reviews it, and reports done', async () => {
    const harness = createHarness();
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);

      expect(goal.state).toBe('done');
      const status = harness.council.status(goalId);
      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0]?.state).toBe('passed');
      expect(status.tasks[0]?.round).toBe(1);
      expect(status.reviews).toHaveLength(1);
      expect(status.reviews[0]?.verdict).toBe('pass');
      expect(harness.ports.pullRequests).toHaveLength(1);
      expect(harness.ports.pullRequests[0]?.title).toBe('Add widget');

      const workerThreadId = status.tasks[0]?.threadId;
      expect(workerThreadId).not.toBeNull();
      expect(harness.ctx.repos.threads.get(workerThreadId ?? '')).toBeDefined();
      expect(harness.ctx.repos.threads.get(workerThreadId ?? '')?.parentThreadId).toBe('thr_goal');

      const states = harness.events
        .filter((event) => event.type === 'council.updated')
        .map((event) => event.payload.state);
      expect(states).toEqual(
        expect.arrayContaining([
          'planning',
          'provisioning',
          'running',
          'reviewing',
          'reporting',
          'done',
        ]),
      );

      const messages = harness.ctx.repos.messages.list('thr_goal');
      const report = messages.find((message) => message.content.includes('Council report'));
      expect(report?.content).toContain('Add widget: passed');
      expect(report?.content).toContain('PR https://example.test/pull/1');

      const childTitles = harness.ports.created.map((request) => request.title);
      expect(childTitles).toEqual([
        'Plan: Ship the widget',
        'Council: Add widget',
        'Review: Add widget',
      ]);
      expect(harness.ports.deleted).toContain('thr_child_1');
      expect(harness.ports.deleted).toContain('thr_child_3');
      expect(harness.ports.deleted).not.toContain(workerThreadId);
    } finally {
      await harness.dispose();
    }
  });

  it('fails the goal when the plan has overlapping file ownership', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(
            input,
            planJson([planTask('One', ['src/shared.ts']), planTask('Two', ['src/shared.ts'])]),
          ),
        );
      }
      return Promise.resolve(result(input, PASS_REVIEW));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('failed');
      expect(harness.council.status(goalId).tasks).toHaveLength(0);
      const messages = harness.ctx.repos.messages.list('thr_goal');
      expect(messages.some((message) => /ownership overlaps/i.test(message.content))).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('enforces the twelve task cap at plan time', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        const tasks = Array.from({ length: 13 }, (_, index) =>
          planTask(`Task ${index}`, [`src/${index}.ts`]),
        );
        return Promise.resolve(result(input, planJson(tasks)));
      }
      return Promise.resolve(result(input, PASS_REVIEW));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('failed');
      expect(
        harness.ctx.repos.messages.list('thr_goal').some((m) => /cap is 12/.test(m.content)),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('reports a planner question as a failed goal', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(result(input, planJson([], 'Which database should this use?')));
      }
      return Promise.resolve(result(input, PASS_REVIEW));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('failed');
      expect(
        harness.ctx.repos.messages
          .list('thr_goal')
          .some((m) => m.content.includes('Which database')),
      ).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('fails a task that produced no changes', async () => {
    const harness = createHarness();
    harness.ports.changed = false;
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('failed');
      const task = harness.council.status(goalId).tasks[0];
      expect(task?.state).toBe('failed');
      expect(task?.error).toContain('no changes');
    } finally {
      await harness.dispose();
    }
  });
});

describe('council review loop', () => {
  it('re-runs the same worker thread after changes-requested and passes on round two', async () => {
    const harness = createHarness();
    let reviewCount = 0;
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(input, planJson([planTask('Add widget', ['src/widget.ts'])])),
        );
      }
      if (title.startsWith('Review:')) {
        reviewCount += 1;
        return Promise.resolve(
          result(
            input,
            reviewCount === 1
              ? 'VERDICT: changes-requested\nFINDINGS: 1. Handle null.'
              : PASS_REVIEW,
          ),
        );
      }
      return Promise.resolve(
        result(input, input.text.includes('REVIEW ROUND') ? 'fixed' : 'worker done'),
      );
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('done');
      const status = harness.council.status(goalId);
      expect(status.tasks[0]?.state).toBe('passed');
      expect(status.tasks[0]?.round).toBe(2);
      expect(status.reviews.map((review) => review.verdict)).toEqual(['changes-requested', 'pass']);
      const workerTurns = harness.ports.workerTurns();
      expect(workerTurns).toHaveLength(2);
      expect(workerTurns[1]?.threadId).toBe(workerTurns[0]?.threadId);
      expect(workerTurns[1]?.text).toContain('REVIEW ROUND 1');
      expect(workerTurns[1]?.text).toContain('Handle null');
    } finally {
      await harness.dispose();
    }
  });

  it('escalates to the captain after three review rounds', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(input, planJson([planTask('Add widget', ['src/widget.ts'])])),
        );
      }
      if (title.startsWith('Review:')) {
        return Promise.resolve(
          result(input, 'VERDICT: changes-requested\nFINDINGS: 1. Still wrong.'),
        );
      }
      return Promise.resolve(result(input, 'worker done'));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('done');
      const status = harness.council.status(goalId);
      expect(status.tasks[0]?.state).toBe('awaiting-captain');
      expect(status.tasks[0]?.round).toBe(3);
      expect(status.reviews).toHaveLength(3);
      expect(harness.ctx.repos.council.listEscalations(status.tasks[0]?.id ?? '')).toHaveLength(1);
      expect(harness.ports.workerTurns()).toHaveLength(3);
    } finally {
      await harness.dispose();
    }
  });

  it('escalates immediately when the reviewer escalates', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(input, planJson([planTask('Add widget', ['src/widget.ts'])])),
        );
      }
      if (title.startsWith('Review:')) {
        return Promise.resolve(result(input, 'VERDICT: escalate\nFINDINGS: needs a product call'));
      }
      return Promise.resolve(result(input, 'worker done'));
    };
    try {
      const goalId = await startGoal(harness);
      await harness.council.awaitGoal(goalId);
      const task = harness.council.status(goalId).tasks[0];
      expect(task?.state).toBe('awaiting-captain');
      expect(task?.round).toBe(1);
      expect(harness.ctx.repos.council.listEscalations(task?.id ?? '')).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });
});

describe('council reviewer selection', () => {
  it('uses a different model family when one is configured', async () => {
    const harness = createHarness();
    try {
      const goalId = await startGoal(harness);
      await harness.council.awaitGoal(goalId);
      const reviewThread = harness.ports.created.find((request) =>
        request.title.startsWith('Review:'),
      );
      expect(reviewThread?.providerId).toBe('prv_codex');
      expect(reviewThread?.modelId).toBe('gpt-x');
    } finally {
      await harness.dispose();
    }
  });

  it('falls back to the author provider and labels the review same-family', async () => {
    const harness = createHarness();
    harness.ctx.repos.providers.replaceModels('prv_codex', []);
    try {
      const goalId = await startGoal(harness);
      await harness.council.awaitGoal(goalId);
      const reviewThread = harness.ports.created.find((request) =>
        request.title.startsWith('Review:'),
      );
      expect(reviewThread?.providerId).toBe('prv_claude');
      expect(reviewThread?.modelId).toBe('claude-x');
      const report = harness.ctx.repos.messages
        .list('thr_goal')
        .find((message) => message.content.includes('Council report'));
      expect(report?.content).toContain('same-family');
    } finally {
      await harness.dispose();
    }
  });
});

describe('council caps', () => {
  it('allows two goals per thread and rejects a third', async () => {
    const harness = createHarness();
    const gate = makeGate();
    harness.ports.handler = async (input, title) => {
      if (title.startsWith('Plan:')) {
        await gate.wait(input.signal);
        return result(input, planJson([planTask('Add widget', ['src/widget.ts'])]));
      }
      return result(input, PASS_REVIEW);
    };
    try {
      const first = await startGoal(harness, 'First goal');
      const second = await startGoal(harness, 'Second goal');
      await expect(startGoal(harness, 'Third goal')).rejects.toThrow(/active council goals/i);
      gate.open();
      await harness.council.cancel(first);
      await harness.council.cancel(second);
      expect(harness.council.status(first).goal.state).toBe('cancelled');
      expect(harness.council.status(second).goal.state).toBe('cancelled');
    } finally {
      await harness.dispose();
    }
  });

  // Nine tasks is the smallest plan that must queue behind the eight-worker cap.
  // Workers block on a manual gate, so the only wall-clock risk is CI starvation
  // (one vitest worker per file on a shared runner); the timeout is headroom, not
  // a wait. The gate opens only after eight workers are observed running.
  it('never runs more than eight workers at once', { timeout: 15_000 }, async () => {
    const harness = createHarness();
    const gate = makeGate();
    harness.ports.handler = async (input, title) => {
      if (title.startsWith('Plan:')) {
        const tasks = Array.from({ length: 9 }, (_, index) =>
          planTask(`Task ${index}`, [`src/${index}.ts`]),
        );
        return result(input, planJson(tasks));
      }
      if (title.startsWith('Review:')) return result(input, PASS_REVIEW);
      await gate.wait(input.signal);
      return result(input, 'worker done');
    };
    try {
      const goalId = await startGoal(harness);
      await harness.ports.when(() => harness.ports.workerMax === 8);
      expect(harness.ports.workerActive).toBeLessThanOrEqual(8);
      gate.open();
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('done');
      expect(harness.council.status(goalId).tasks.every((task) => task.state === 'passed')).toBe(
        true,
      );
      expect(harness.ports.workerMax).toBe(8);
    } finally {
      await harness.dispose();
    }
  });
});

describe('council dependencies', () => {
  it('fails a dependent task when its dependency failed', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(
            input,
            planJson([
              planTask('First', ['src/first.ts']),
              planTask('Second', ['src/second.ts'], ['First']),
            ]),
          ),
        );
      }
      if (title === 'Council: First') return Promise.resolve(result(input, '', 'error'));
      return Promise.resolve(result(input, PASS_REVIEW));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('failed');
      const tasks = harness.council.status(goalId).tasks;
      expect(tasks.find((task) => task.title === 'First')?.state).toBe('failed');
      const second = tasks.find((task) => task.title === 'Second');
      expect(second?.state).toBe('failed');
      expect(second?.dependsOn).toEqual(['First']);
      expect(second?.error).toContain('blocked by');
      expect(harness.ports.created.some((request) => request.title === 'Council: Second')).toBe(
        false,
      );
    } finally {
      await harness.dispose();
    }
  });
});

describe('council dependencies', () => {
  it('blocks a dependent task while its dependency awaits the captain', async () => {
    const harness = createHarness();
    harness.ports.handler = (input, title) => {
      if (title.startsWith('Plan:')) {
        return Promise.resolve(
          result(
            input,
            planJson([
              planTask('First', ['src/first.ts']),
              planTask('Second', ['src/second.ts'], ['First']),
            ]),
          ),
        );
      }
      if (title.startsWith('Review:')) {
        return Promise.resolve(result(input, 'VERDICT: escalate\nFINDINGS: needs a call'));
      }
      return Promise.resolve(result(input, 'worker done'));
    };
    try {
      const goalId = await startGoal(harness);
      const goal = await harness.council.awaitGoal(goalId);
      expect(goal.state).toBe('done');
      const tasks = harness.council.status(goalId).tasks;
      expect(tasks.find((task) => task.title === 'First')?.state).toBe('awaiting-captain');
      const second = tasks.find((task) => task.title === 'Second');
      expect(second?.state).toBe('blocked');
      expect(second?.error).toContain('blocked by');
      expect(harness.ports.created.some((request) => request.title === 'Council: Second')).toBe(
        false,
      );
    } finally {
      await harness.dispose();
    }
  });
});

describe('council cancellation', () => {
  it('stops the worker, disposes child threads, and marks rows cancelled', async () => {
    const harness = createHarness();
    const gate = makeGate();
    harness.ports.handler = async (input, title) => {
      if (title.startsWith('Plan:')) {
        return result(input, planJson([planTask('Add widget', ['src/widget.ts'])]));
      }
      if (title.startsWith('Review:')) return result(input, PASS_REVIEW);
      await gate.wait(input.signal);
      return result(input, 'worker done');
    };
    try {
      const goalId = await startGoal(harness);
      await harness.ports.when(() => harness.ports.workerActive === 1);
      const workerThreadId = harness.council.status(goalId).tasks[0]?.threadId;
      expect(workerThreadId).toBeTruthy();

      await harness.council.cancel(goalId);
      const status = harness.council.status(goalId);
      expect(status.goal.state).toBe('cancelled');
      expect(status.tasks[0]?.state).toBe('cancelled');
      expect(harness.disposed).toContain(workerThreadId);
      expect(harness.ctx.repos.threads.get(workerThreadId ?? '')).toBeUndefined();
      expect(harness.ports.deleted).toContain(workerThreadId);
      expect((await harness.council.awaitGoal(goalId)).state).toBe('cancelled');

      await expect(harness.council.cancel(goalId)).resolves.toBeUndefined();
      await expect(harness.council.cancel('gol_missing')).rejects.toThrow(/goal not found/i);
    } finally {
      gate.open();
      await harness.dispose();
    }
  });
});

describe('council.latest', () => {
  it('returns the newest goal on the thread with its tasks and reviews', async () => {
    const harness = createHarness();
    try {
      expect(harness.council.latest('thr_goal')).toBeNull();
      expect(harness.council.latest('thr_missing')).toBeNull();

      const firstId = await startGoal(harness, 'First goal');
      await harness.council.awaitGoal(firstId);
      const secondId = await startGoal(harness, 'Second goal');
      await harness.council.awaitGoal(secondId);

      const latest = harness.council.latest('thr_goal');
      expect(latest?.goal.id).toBe(secondId);
      expect(latest?.goal.text).toBe('Second goal');
      expect(latest?.tasks.map((task) => task.title)).toEqual(['Add widget']);
      expect(latest?.reviews).toHaveLength(1);
      expect(latest?.reviews[0]?.taskId).toBe(latest?.tasks[0]?.id);
    } finally {
      await harness.dispose();
    }
  });
});
