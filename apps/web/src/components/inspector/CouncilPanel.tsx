import type { GoalAutonomy, RpcResult } from '@tuffcode/contracts';
import { Badge, Button, EmptyState, ScrollArea, Select, Spinner, Textarea } from '@tuffcode/ui';
import { Crown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import {
  GOAL_STATE_LABEL,
  GOAL_STATE_TONE,
  REVIEW_VERDICT_LABEL,
  REVIEW_VERDICT_TONE,
  TASK_STATE_LABEL,
  TASK_STATE_TONE,
  councilErrorMessage,
  countFinishedTasks,
  isGoalTerminal,
} from './council-model';
import { forgetCouncilGoal, rememberCouncilGoal, rememberedCouncilGoal } from './council-goals';

export interface CouncilPanelProps {
  threadId: string;
}

type CouncilStatus = RpcResult<'council.status'>;

const POLL_INTERVAL_MS = 3000;

const AUTONOMY_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto' },
];

function isAutonomy(value: unknown): value is GoalAutonomy {
  return value === 'manual' || value === 'auto';
}

/**
 * Council dashboard: start a goal for this thread, follow its task states while it
 * runs, cancel it, and read the reviewer verdicts.
 */
export function CouncilPanel({ threadId }: CouncilPanelProps) {
  const rpc = useRpc();

  const [goalId, setGoalId] = useState<string | null>(() => rememberedCouncilGoal(threadId));
  const [status, setStatus] = useState<CouncilStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [goalText, setGoalText] = useState('');
  const [autonomy, setAutonomy] = useState<GoalAutonomy>('manual');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (goalId === null) return;
    setLoading(true);
    try {
      const next = await rpc.request('council.status', { goalId });
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError(councilErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [rpc, goalId]);

  useEffect(() => {
    if (goalId === null) {
      setStatus(null);
      setError(null);
      return;
    }
    void load();
  }, [goalId, load, reloadToken]);

  const goalState = status?.goal.state;
  useEffect(() => {
    if (goalId === null) return;
    if (goalState !== undefined && isGoalTerminal(goalState)) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [goalId, goalState, load]);

  async function handleStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const goal = goalText.trim();
    if (goal.length === 0 || starting) return;

    setStarting(true);
    setStartError(null);
    try {
      const started = await rpc.request('council.start', { threadId, goal, autonomy });
      rememberCouncilGoal(threadId, started.goalId);
      setStatus(null);
      setError(null);
      setGoalText('');
      setGoalId(started.goalId);
    } catch (cause) {
      setStartError(councilErrorMessage(cause));
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (goalId === null || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await rpc.request('council.cancel', { goalId });
      await load();
    } catch (cause) {
      setCancelError(councilErrorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }

  function handleNewGoal(): void {
    forgetCouncilGoal(threadId);
    setGoalId(null);
    setStatus(null);
    setError(null);
    setCancelError(null);
    setStartError(null);
  }

  if (goalId === null) {
    return (
      <section
        aria-label="Council"
        data-testid="council-panel"
        className="flex h-full min-h-0 flex-col bg-background text-foreground"
      >
        <ScrollArea className="min-h-0 flex-1">
          <form onSubmit={(event) => void handleStart(event)} className="flex flex-col gap-2 p-3">
            <label
              htmlFor="council-goal"
              className="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Goal
            </label>
            <Textarea
              id="council-goal"
              rows={4}
              placeholder="What should the council ship?"
              value={goalText}
              onChange={(event) => setGoalText(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <div className="w-28 shrink-0">
                <Select
                  aria-label="Goal autonomy"
                  className="h-8 text-xs"
                  options={AUTONOMY_OPTIONS}
                  value={autonomy}
                  onValueChange={(value) => {
                    if (isAutonomy(value)) setAutonomy(value);
                  }}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={starting || goalText.trim().length === 0}
              >
                {starting ? <Spinner size="sm" label="Starting goal" /> : null}
                Start goal
              </Button>
            </div>
            <p className="text-2xs leading-5 text-muted-foreground">
              Manual asks before each task starts. Auto plans, runs and reviews without stopping.
            </p>
            {startError ? (
              <p role="alert" className="text-2xs leading-5 text-error">
                {startError}
              </p>
            ) : null}
          </form>

          <div className="px-3 pb-3">
            <EmptyState
              icon={Crown}
              title="No council goal running"
              description="A goal splits into tasks, each with an author and a reviewer. Start one to watch it here."
              className="w-full"
            />
          </div>
        </ScrollArea>
      </section>
    );
  }

  const terminal = goalState !== undefined && isGoalTerminal(goalState);

  return (
    <section
      aria-label="Council"
      data-testid="council-panel"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      {status === null ? (
        <div className="flex flex-1 items-center justify-center p-4">
          {error === null ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" label="Loading goal" />
              Loading goal
            </span>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p role="alert" className="max-w-72 text-center text-xs leading-5 text-error">
                {error}
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setReloadToken((t) => t + 1)}>
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={handleNewGoal}>
                  New goal
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Badge variant={GOAL_STATE_TONE[status.goal.state]}>
              {GOAL_STATE_LABEL[status.goal.state]}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs" title={status.goal.text}>
              {status.goal.text}
            </span>
            {loading ? <Spinner size="sm" label="Refreshing goal" /> : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-2xs text-muted-foreground">
            <span>{status.goal.autonomy === 'auto' ? 'Auto' : 'Manual'}</span>
            <span className="tabular-nums">
              {countFinishedTasks(status.tasks)}/{status.tasks.length} tasks finished
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RefreshCw strokeWidth={1.75} />
                Refresh
              </Button>
              {terminal ? (
                <Button size="sm" variant="outline" onClick={handleNewGoal}>
                  New goal
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelling}
                  onClick={() => void handleCancel()}
                >
                  {cancelling ? <Spinner size="sm" label="Cancelling goal" /> : null}
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="shrink-0 border-b border-border px-3 py-2 text-2xs text-error"
            >
              {error}
            </p>
          ) : null}
          {cancelError ? (
            <p
              role="alert"
              className="shrink-0 border-b border-border px-3 py-2 text-2xs text-error"
            >
              {cancelError}
            </p>
          ) : null}

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Tasks
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {status.tasks.length}
                </span>
              </div>
              {status.tasks.length === 0 ? (
                <p className="px-3 pb-2 text-2xs leading-5 text-muted-foreground">
                  The goal has not split into tasks yet.
                </p>
              ) : (
                <ul
                  aria-label="Council tasks"
                  className="divide-y divide-border border-y border-border"
                >
                  {status.tasks.map((task) => (
                    <li key={task.id} className="flex flex-col gap-1 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge variant={TASK_STATE_TONE[task.state]} size="sm">
                          {TASK_STATE_LABEL[task.state]}
                        </Badge>
                        <span
                          className="min-w-0 flex-1 truncate text-xs font-medium"
                          title={task.title}
                        >
                          {task.title}
                        </span>
                        {task.critical ? (
                          <span className="shrink-0 text-2xs text-warning-foreground">
                            critical
                          </span>
                        ) : null}
                        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                          round {task.round}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
                        <span>
                          author {task.authorProvider}/{task.authorModel}
                        </span>
                        {task.reviewerModel !== null ? (
                          <span>
                            review {task.reviewerProvider ?? 'unknown'}/{task.reviewerModel}
                          </span>
                        ) : null}
                      </div>
                      {task.error !== null ? (
                        <p className="text-2xs leading-5 text-error">{task.error}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Reviews
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {status.reviews.length}
                </span>
              </div>
              {status.reviews.length === 0 ? (
                <p className="px-3 pb-2 text-2xs leading-5 text-muted-foreground">
                  No reviewer verdicts yet.
                </p>
              ) : (
                <ul
                  aria-label="Council reviews"
                  className="divide-y divide-border border-t border-border"
                >
                  {status.reviews.map((review) => (
                    <li key={review.id} className="flex flex-col gap-1 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge variant={REVIEW_VERDICT_TONE[review.verdict]} size="sm">
                          {REVIEW_VERDICT_LABEL[review.verdict]}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                          {status.tasks.find((task) => task.id === review.taskId)?.title ??
                            review.taskId}
                        </span>
                        <span className="shrink-0 text-2xs text-muted-foreground">
                          {review.modelId}
                        </span>
                      </div>
                      {review.body.length > 0 ? (
                        <p className="text-xs leading-5 break-words whitespace-pre-wrap">
                          {review.body}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </section>
  );
}
