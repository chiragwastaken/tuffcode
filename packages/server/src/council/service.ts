import type {
  Goal,
  GoalState,
  Review,
  ReviewVerdict,
  Task,
  TaskState,
  Thread,
} from '@tuffcode/contracts';
import { newId, type Logger } from '@tuffcode/shared';
import type { Repos, TaskStatePatch } from '../db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import { openPullRequest as openPullRequestInRepo, pushThread } from '../git/index.js';
import type { Runner } from '../runner/runner.js';
import { COUNCIL_CAPS, TERMINAL_GOAL_STATES, TERMINAL_TASK_STATES } from './caps.js';
import { providerFamily, selectReviewer } from './family.js';
import { changesForThread } from './git.js';
import { parsePlan } from './plan.js';
import {
  buildPlannerPrompt,
  buildReviewPrompt,
  buildRevisionBrief,
  buildWorkerBrief,
  parsePullRequestUrl,
  parseReviewVerdict,
} from './prompts.js';
import { createBusTurnRunner } from './runner-turn.js';
import { deleteChildThread, provisionChildThread } from './threads.js';
import type {
  Council,
  CouncilPorts,
  CouncilStartInput,
  CouncilStatus,
  CouncilPlan,
  PlanTask,
  PullRequest,
} from './types.js';

export interface CouncilDeps {
  repos: Repos;
  bus: EventBus;
  runner: Runner;
  logger: Logger;
  /** Test seam: any port may be replaced by a fake. */
  ports?: Partial<CouncilPorts>;
}

interface GoalRun {
  goalId: string;
  threadId: string;
  controller: AbortController;
  cancelled: boolean;
  childThreads: Set<string>;
  planTasks: Map<string, PlanTask>;
  promise: Promise<void>;
  resolveDone: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pullRequestNumber(url: string): number {
  const match = /\/pull\/(\d+)/.exec(url);
  return match === null ? 0 : Number.parseInt(match[1] ?? '0', 10);
}

function dependenciesPassed(planTask: PlanTask, byTitle: Map<string, Task>): boolean {
  return planTask.dependsOn.every((title) => {
    const task = byTitle.get(title.toLowerCase());
    return task !== undefined && (task.state === 'passed' || task.state === 'merged');
  });
}

function blockedReason(planTask: PlanTask, byTitle: Map<string, Task>): string {
  const waiting = planTask.dependsOn.map((title) => {
    const task = byTitle.get(title.toLowerCase());
    return `"${title}" is ${task === undefined ? 'missing' : task.state}`;
  });
  return `blocked by ${waiting.join(', ')}`;
}

function escalationQuestion(
  planTask: PlanTask,
  verdict: ReviewVerdict,
  round: number,
  body: string,
): string {
  const reason =
    verdict === 'escalate' ? 'the reviewer escalated' : `round ${round} still requested changes`;
  const detail = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12)
    .join('\n');
  return `Task "${planTask.title}": ${reason}. Captain decision required.\n\n${detail}`;
}

/**
 * Council orchestration: one goal thread, a planner turn, one child thread per
 * task, a pull request per task, and one cross-family review per round. All side
 * effects go through `CouncilPorts`, so the service itself is a state machine over
 * the council repos.
 */
export function createCouncil(deps: CouncilDeps): Council {
  const { repos, bus, logger } = deps;
  const overrides = deps.ports ?? {};
  // Ports may be class instances whose methods live on the prototype, so every
  // override is bound before it is called from the service.
  const ports: CouncilPorts = {
    createThread:
      overrides.createThread?.bind(overrides) ??
      ((request) => provisionChildThread(repos, request)),
    deleteThread:
      overrides.deleteThread?.bind(overrides) ?? ((threadId) => deleteChildThread(repos, threadId)),
    runTurn:
      overrides.runTurn?.bind(overrides) ?? createBusTurnRunner({ bus, runner: deps.runner }),
    openPullRequest:
      overrides.openPullRequest?.bind(overrides) ??
      (async (threadId, request) => {
        await pushThread(repos, threadId);
        const result = await openPullRequestInRepo(repos, threadId, { ...request, draft: false });
        repos.threads.setPrUrl(threadId, result.url);
        return result;
      }),
    changesForThread:
      overrides.changesForThread?.bind(overrides) ??
      ((threadId) => changesForThread(repos, threadId)),
  };
  const runs = new Map<string, GoalRun>();

  function emitGoal(goal: Goal): void {
    bus.emit({
      kind: 'event',
      type: 'council.updated',
      threadId: goal.threadId,
      payload: { goalId: goal.id, state: goal.state },
    });
  }

  function requireGoal(goalId: string): Goal {
    const goal = repos.council.getGoal(goalId);
    if (goal === undefined) throw notFound('goal not found');
    return goal;
  }

  function requireThread(threadId: string): Thread {
    const thread = repos.threads.get(threadId);
    if (thread === undefined) throw notFound('thread not found');
    return thread;
  }

  function advanceGoal(goalId: string, state: GoalState, reportedAt: string | null = null): Goal {
    const current = requireGoal(goalId);
    if (current.state === state) return current;
    if (TERMINAL_GOAL_STATES[current.state] === true) return current;
    const next = repos.council.setGoalState(goalId, state, reportedAt) ?? current;
    emitGoal(next);
    return next;
  }

  function advanceTask(
    run: GoalRun,
    taskId: string,
    state: TaskState,
    patch?: TaskStatePatch,
  ): Task | undefined {
    if (run.cancelled && state !== 'cancelled') return undefined;
    const current = repos.council.getTask(taskId);
    if (current === undefined) return undefined;
    if (TERMINAL_TASK_STATES[current.state] === true && state !== current.state) return current;
    return repos.council.setTaskState(taskId, state, patch);
  }

  function addGoalMessage(goal: Goal, content: string): void {
    repos.messages.add({
      id: newId('msg'),
      threadId: goal.threadId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    });
  }

  async function disposeChild(run: GoalRun, threadId: string): Promise<void> {
    try {
      await ports.deleteThread(threadId);
    } catch (error) {
      logger.warn('council child thread dispose failed', {
        goalId: run.goalId,
        threadId,
        message: errorMessage(error),
      });
    }
    run.childThreads.delete(threadId);
  }

  function cancelOpenTasks(goalId: string): void {
    for (const task of repos.council.listTasks(goalId)) {
      if (TERMINAL_TASK_STATES[task.state] === true) continue;
      repos.council.setTaskState(task.id, 'cancelled');
    }
  }

  function failOpenTasks(goalId: string, message: string): void {
    for (const task of repos.council.listTasks(goalId)) {
      if (TERMINAL_TASK_STATES[task.state] === true) continue;
      repos.council.setTaskState(task.id, 'failed', { error: message });
    }
  }

  async function planGoal(goal: Goal, run: GoalRun): Promise<CouncilPlan> {
    const thread = requireThread(goal.threadId);
    const project = repos.projects.get(thread.projectId);
    if (project === undefined) throw notFound('project not found');
    const baseBranch = thread.baseBranch ?? project.defaultBranch;
    const planner = await ports.createThread({
      projectId: project.id,
      parentThreadId: thread.id,
      title: `Plan: ${goal.text.slice(0, 60)}`,
      providerId: thread.providerId,
      modelId: thread.modelId,
      executionMode: 'plan',
      permissionMode: 'read-only',
      baseBranch,
    });
    run.childThreads.add(planner.id);
    try {
      const result = await ports.runTurn({
        threadId: planner.id,
        text: buildPlannerPrompt({
          goal: goal.text,
          projectName: project.name,
          projectPath: project.path,
          baseBranch,
        }),
        signal: run.controller.signal,
      });
      if (run.cancelled) return { tasks: [], question: null };
      if (result.status !== 'complete') {
        throw new Error(result.error ?? `planner turn ${result.status}`);
      }
      return parsePlan(result.text);
    } finally {
      await disposeChild(run, planner.id);
    }
  }

  function createTasks(goal: Goal, run: GoalRun, planTasks: readonly PlanTask[]): void {
    const thread = requireThread(goal.threadId);
    for (const planTask of planTasks) {
      const task = repos.council.createTask({
        goalId: goal.id,
        title: planTask.title,
        brief: planTask.brief,
        state: 'queued',
        authorProvider: thread.providerId,
        authorModel: thread.modelId,
        critical: planTask.critical,
        round: 0,
      });
      run.planTasks.set(task.id, planTask);
    }
  }

  async function ensurePullRequest(
    goal: Goal,
    planTask: PlanTask,
    child: Thread,
    workerReport: string,
  ): Promise<PullRequest> {
    const existingUrl = repos.threads.get(child.id)?.prUrl ?? parsePullRequestUrl(workerReport);
    if (existingUrl !== null && existingUrl !== undefined) {
      repos.threads.setPrUrl(child.id, existingUrl);
      return { url: existingUrl, number: pullRequestNumber(existingUrl) };
    }
    const changes = await ports.changesForThread(child.id);
    if (!changes.changed) throw new Error('worker produced no changes');
    const result = await ports.openPullRequest(child.id, {
      title: planTask.title,
      body: [
        `Goal: ${goal.text}`,
        '',
        planTask.brief,
        '',
        `Council task opened automatically for goal ${goal.id}.`,
      ].join('\n'),
    });
    repos.threads.setPrUrl(child.id, result.url);
    return result;
  }

  function maybeEnterReviewing(goal: Goal): void {
    const current = repos.council.getGoal(goal.id);
    if (current === undefined || current.state !== 'running') return;
    const working = repos.council
      .listTasks(goal.id)
      .some(
        (task) =>
          task.state === 'queued' ||
          task.state === 'provisioning' ||
          task.state === 'running' ||
          task.state === 'changes-requested',
      );
    if (!working) advanceGoal(goal.id, 'reviewing');
  }

  async function reviewTask(
    goal: Goal,
    run: GoalRun,
    task: Task,
    planTask: PlanTask,
    child: Thread,
    pullRequest: PullRequest,
    workerReport: string,
  ): Promise<void> {
    const selection = selectReviewer({
      providers: repos.providers.list(),
      models: (providerId) => repos.providers.listModels(providerId),
      authorProviderId: task.authorProvider,
      authorModelId: task.authorModel,
    });
    let reviewThreadId: string | null = null;
    let round = task.round;
    try {
      for (;;) {
        if (run.cancelled) return;
        const goalThread = requireThread(goal.threadId);
        const project = repos.projects.get(goalThread.projectId);
        if (project === undefined) throw notFound('project not found');
        const baseBranch = goalThread.baseBranch ?? project.defaultBranch;
        if (reviewThreadId === null) {
          const reviewThread = await ports.createThread({
            projectId: project.id,
            parentThreadId: child.id,
            title: `Review: ${planTask.title}`,
            providerId: selection.providerId,
            modelId: selection.modelId,
            executionMode: 'plan',
            permissionMode: 'read-only',
            baseBranch,
          });
          reviewThreadId = reviewThread.id;
          run.childThreads.add(reviewThread.id);
        }
        if (run.cancelled) return;
        maybeEnterReviewing(goal);
        advanceTask(run, task.id, 'reviewing');
        const changes = await ports.changesForThread(child.id);
        const review = await ports.runTurn({
          threadId: reviewThreadId,
          text: buildReviewPrompt({
            task: planTask,
            prUrl: pullRequest.url,
            workerReport,
            patch: changes.patch,
          }),
          signal: run.controller.signal,
        });
        if (run.cancelled) return;
        const verdict = review.status === 'complete' ? parseReviewVerdict(review.text) : 'escalate';
        round += 1;
        const body =
          review.text.trim().length > 0
            ? review.text
            : (review.error ?? `review turn ${review.status}`);
        const stored = repos.council.createReview({
          taskId: task.id,
          providerId: selection.providerId,
          modelId: selection.modelId,
          verdict,
          body,
        });
        advanceTask(run, task.id, 'reviewing', {
          round,
          reviewerProvider: selection.providerId,
          reviewerModel: selection.modelId,
        });

        if (verdict === 'pass') {
          advanceTask(run, task.id, 'passed');
          return;
        }
        if (verdict === 'escalate' || round >= COUNCIL_CAPS.reviewRounds) {
          repos.council.createEscalation({
            taskId: task.id,
            question: escalationQuestion(planTask, verdict, round, stored.body),
          });
          advanceTask(run, task.id, 'awaiting-captain');
          return;
        }

        advanceTask(run, task.id, 'changes-requested');
        advanceTask(run, task.id, 'running');
        const revision = await ports.runTurn({
          threadId: child.id,
          text: buildRevisionBrief({ round, findings: stored.body }),
          signal: run.controller.signal,
        });
        if (run.cancelled) return;
        if (revision.status !== 'complete') {
          throw new Error(revision.error ?? `revision turn ${revision.status}`);
        }
        advanceTask(run, task.id, 'pr-open');
      }
    } finally {
      if (reviewThreadId !== null) await disposeChild(run, reviewThreadId);
    }
  }

  async function executeTask(
    goal: Goal,
    run: GoalRun,
    task: Task,
    planTask: PlanTask,
  ): Promise<void> {
    if (run.cancelled) return;
    const goalThread = requireThread(goal.threadId);
    const project = repos.projects.get(goalThread.projectId);
    if (project === undefined) throw notFound('project not found');
    const baseBranch = goalThread.baseBranch ?? project.defaultBranch;

    advanceTask(run, task.id, 'provisioning');
    const child = await ports.createThread({
      projectId: project.id,
      parentThreadId: goalThread.id,
      title: `Council: ${planTask.title}`,
      providerId: goalThread.providerId,
      modelId: goalThread.modelId,
      executionMode: 'work',
      permissionMode: 'full-auto',
      baseBranch,
    });
    run.childThreads.add(child.id);
    if (run.cancelled) return;
    const running = advanceTask(run, task.id, 'running', { threadId: child.id }) ?? task;

    const order = [...run.planTasks.keys()];
    const worker = await ports.runTurn({
      threadId: child.id,
      text: buildWorkerBrief({
        task: planTask,
        goal: goal.text,
        goalId: goal.id,
        projectName: project.name,
        projectPath: project.path,
        baseBranch,
        worktreePath: child.worktreePath ?? '(missing)',
        branch: child.branch ?? '(missing)',
        taskIndex: Math.max(0, order.indexOf(task.id)),
        taskCount: order.length,
      }),
      signal: run.controller.signal,
    });
    if (run.cancelled) return;
    if (worker.status !== 'complete') {
      throw new Error(worker.error ?? `worker turn ${worker.status}`);
    }

    const pullRequest = await ensurePullRequest(goal, planTask, child, worker.text);
    if (run.cancelled) return;
    advanceTask(run, task.id, 'pr-open');
    await reviewTask(goal, run, running, planTask, child, pullRequest, worker.text);
  }

  async function executeTasks(goal: Goal, run: GoalRun): Promise<void> {
    const inflight = new Map<string, Promise<void>>();
    for (;;) {
      if (run.cancelled) break;
      const tasks = repos.council.listTasks(goal.id);
      const byTitle = new Map(tasks.map((task) => [task.title.toLowerCase(), task]));
      for (const task of tasks) {
        if (task.state !== 'queued' || inflight.has(task.id)) continue;
        const planTask = run.planTasks.get(task.id);
        if (planTask === undefined) continue;
        if (!dependenciesPassed(planTask, byTitle)) continue;
        if (inflight.size >= COUNCIL_CAPS.concurrentWorkers) break;
        const promise = executeTask(goal, run, task, planTask)
          .catch((error) => {
            if (run.cancelled) return;
            const message = errorMessage(error);
            logger.warn('council task failed', {
              goalId: goal.id,
              taskId: task.id,
              message,
            });
            advanceTask(run, task.id, 'failed', { error: message });
          })
          .finally(() => {
            inflight.delete(task.id);
          });
        inflight.set(task.id, promise);
      }

      if (inflight.size === 0) {
        const remaining = repos.council
          .listTasks(goal.id)
          .filter((task) => task.state === 'queued');
        if (remaining.length === 0) break;
        const byRemainingTitle = new Map(
          repos.council.listTasks(goal.id).map((task) => [task.title.toLowerCase(), task]),
        );
        for (const task of remaining) {
          const planTask = run.planTasks.get(task.id);
          if (planTask === undefined) {
            advanceTask(run, task.id, 'failed', { error: 'plan metadata is missing' });
            continue;
          }
          const waitingOnCaptain = planTask.dependsOn.some((title) => {
            const dependency = byRemainingTitle.get(title.toLowerCase());
            return dependency?.state === 'awaiting-captain' || dependency?.state === 'blocked';
          });
          advanceTask(run, task.id, waitingOnCaptain ? 'blocked' : 'failed', {
            error: blockedReason(planTask, byRemainingTitle),
          });
        }
        continue;
      }

      await Promise.race(inflight.values());
    }
    await Promise.allSettled(inflight.values());
  }

  function reviewLabel(review: Review, task: Task): string {
    const reviewer = repos.providers.get(review.providerId);
    const author = repos.providers.get(task.authorProvider);
    const reviewerFamily =
      reviewer === undefined ? 'unknown' : providerFamily(reviewer.kind, reviewer.config);
    const authorFamily =
      author === undefined ? 'unknown' : providerFamily(author.kind, author.config);
    return reviewerFamily === authorFamily ? `${review.verdict} (same-family)` : review.verdict;
  }

  function summarise(goal: Goal): { state: 'done' | 'failed'; report: string } {
    const tasks = repos.council.listTasks(goal.id);
    const succeeded = tasks.some(
      (task) =>
        task.state === 'passed' || task.state === 'merged' || task.state === 'awaiting-captain',
    );
    const lines = tasks.map((task) => {
      const thread = task.threadId === null ? undefined : repos.threads.get(task.threadId);
      const review = repos.council.listReviews(task.id).at(-1);
      const parts = [`- ${task.title}: ${task.state}`];
      if (task.round > 0) parts.push(`round ${task.round}`);
      if (review !== undefined) parts.push(`review ${reviewLabel(review, task)}`);
      if (thread?.prUrl !== undefined && thread?.prUrl !== null) parts.push(`PR ${thread.prUrl}`);
      if (task.error !== null) parts.push(`error: ${task.error}`);
      return parts.join(' | ');
    });
    return {
      state: succeeded ? 'done' : 'failed',
      report: [`Council report for goal ${goal.id}: ${goal.text}`, '', ...lines].join('\n'),
    };
  }

  async function runGoal(goal: Goal, run: GoalRun): Promise<void> {
    try {
      advanceGoal(goal.id, 'planning');
      const plan = await planGoal(goal, run);
      if (run.cancelled) return;
      if (plan.tasks.length === 0) {
        addGoalMessage(
          goal,
          `Council could not plan this goal.\n\n${plan.question ?? 'The planner returned no tasks.'}`,
        );
        advanceGoal(goal.id, 'failed');
        return;
      }
      advanceGoal(goal.id, 'provisioning');
      createTasks(goal, run, plan.tasks);
      if (run.cancelled) return;
      advanceGoal(goal.id, 'running');
      await executeTasks(goal, run);
      if (run.cancelled) return;
      advanceGoal(goal.id, 'reporting');
      const outcome = summarise(goal);
      addGoalMessage(goal, outcome.report);
      advanceGoal(
        goal.id,
        outcome.state,
        outcome.state === 'done' ? new Date().toISOString() : null,
      );
    } catch (error) {
      if (run.cancelled) return;
      const message = errorMessage(error);
      logger.warn('council goal failed', { goalId: goal.id, message });
      failOpenTasks(goal.id, message);
      addGoalMessage(goal, `Council failed: ${message}`);
      advanceGoal(goal.id, 'failed');
    }
  }

  async function start(input: CouncilStartInput): Promise<{ goalId: string }> {
    const thread = requireThread(input.threadId);
    const project = repos.projects.get(thread.projectId);
    if (project === undefined) throw notFound('project not found');
    const provider = repos.providers.get(thread.providerId);
    if (provider === undefined) throw notFound('provider not found');
    if (!provider.enabled) {
      throw new RpcError('provider-unavailable', 'provider is disabled');
    }
    const text = input.goal.trim();
    if (text.length === 0) throw badRequest('goal text is required');
    if (deps.runner.listActive().some((active) => active.threadId === thread.id)) {
      throw conflict('thread already has an active turn');
    }
    const activeGoals = repos.council
      .listGoals(thread.id)
      .filter((goal) => TERMINAL_GOAL_STATES[goal.state] !== true);
    if (activeGoals.length >= COUNCIL_CAPS.goalsPerThread) {
      throw conflict(`thread already has ${activeGoals.length} active council goals`);
    }

    const goal = repos.council.createGoal({
      threadId: thread.id,
      text,
      autonomy: input.autonomy,
      state: 'intake',
    });
    emitGoal(goal);
    const { promise, resolve } = Promise.withResolvers<void>();
    const run: GoalRun = {
      goalId: goal.id,
      threadId: thread.id,
      controller: new AbortController(),
      cancelled: false,
      childThreads: new Set(),
      planTasks: new Map(),
      promise,
      resolveDone: resolve,
    };
    runs.set(goal.id, run);
    void runGoal(goal, run)
      .catch((error) => {
        logger.error('council run crashed', {
          goalId: goal.id,
          message: errorMessage(error),
        });
      })
      .finally(() => {
        run.resolveDone();
        runs.delete(goal.id);
      });
    return { goalId: goal.id };
  }

  async function cancel(goalId: string): Promise<void> {
    const goal = requireGoal(goalId);
    const run = runs.get(goalId);
    if (run === undefined || TERMINAL_GOAL_STATES[goal.state] === true) {
      if (TERMINAL_GOAL_STATES[goal.state] !== true) {
        const cancelled = repos.council.setGoalState(goalId, 'cancelled');
        if (cancelled !== undefined) emitGoal(cancelled);
        cancelOpenTasks(goalId);
      }
      return;
    }

    run.cancelled = true;
    run.controller.abort();
    const cancelled = repos.council.setGoalState(goalId, 'cancelled');
    if (cancelled !== undefined) emitGoal(cancelled);
    cancelOpenTasks(goalId);

    for (const threadId of Array.from(run.childThreads)) {
      await deps.runner.disposeThread(threadId).catch(() => undefined);
    }
    await run.promise.catch(() => undefined);
    for (const threadId of Array.from(run.childThreads)) {
      await disposeChild(run, threadId);
    }
    addGoalMessage(goal, 'Council cancelled by the user.');
  }

  function status(goalId: string): CouncilStatus {
    const goal = requireGoal(goalId);
    const tasks = repos.council.listTasks(goalId);
    const reviews = tasks.flatMap((task) => repos.council.listReviews(task.id));
    return { goal, tasks, reviews };
  }

  async function awaitGoal(goalId: string): Promise<Goal> {
    const run = runs.get(goalId);
    if (run !== undefined) await run.promise;
    return requireGoal(goalId);
  }

  async function dispose(): Promise<void> {
    for (const goalId of Array.from(runs.keys())) {
      await cancel(goalId).catch((error) => {
        logger.warn('council goal dispose failed', {
          goalId,
          message: errorMessage(error),
        });
      });
    }
  }

  return { start, cancel, status, awaitGoal, dispose };
}
