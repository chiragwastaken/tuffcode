import type { TodoPhase, TodoStatus } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import { Check, CircleDashed, CircleDot, Minus } from 'lucide-react';
import { useEffect } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

const STATUS_ICON = {
  pending: CircleDashed,
  in_progress: CircleDot,
  completed: Check,
  abandoned: Minus,
} as const;

const STATUS_CLASS: Record<TodoStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-info-foreground',
  completed: 'text-success-foreground',
  abandoned: 'text-muted-foreground line-through',
};

const EMPTY: TodoPhase[] = [];

export function todoProgress(phases: readonly TodoPhase[]): { done: number; total: number } {
  const tasks = phases.flatMap((phase) => phase.tasks);
  return {
    done: tasks.filter((task) => task.status === 'completed' || task.status === 'abandoned').length,
    total: tasks.length,
  };
}

/** Loads a thread's list once; later changes arrive as `todo.updated`. */
export function useThreadTodos(threadId: string): TodoPhase[] {
  const rpc = useRpc();
  const phases = useAppStore((state) => state.todos[threadId]);
  const setTodos = useAppStore((state) => state.setTodos);
  useEffect(() => {
    if (phases !== undefined) return;
    let disposed = false;
    void rpc.request('todos.get', { threadId }).then(
      (list) => {
        if (!disposed) setTodos(threadId, list.phases);
      },
      () => undefined,
    );
    return () => {
      disposed = true;
    };
  }, [phases, rpc, setTodos, threadId]);
  return phases ?? EMPTY;
}

/** The agent's task list, phases as small headings, one row per task. */
export function TodoList({ phases, compact = false }: { phases: readonly TodoPhase[]; compact?: boolean }) {
  return (
    <div data-testid="todo-list" className="flex flex-col gap-1">
      {phases.map((phase) => {
        const progress = todoProgress([phase]);
        return (
          <div key={phase.name} className="flex flex-col">
            {phases.length > 1 || !compact ? (
              <div className="flex items-baseline justify-between px-1.5 py-0.5 text-2xs text-muted-foreground">
                <span className="truncate font-medium">{phase.name}</span>
                <span className="tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              </div>
            ) : null}
            <ul className="flex flex-col">
              {phase.tasks.map((task, index) => {
                const Icon = STATUS_ICON[task.status];
                return (
                  <li
                    key={`${task.content}-${index}`}
                    data-testid="todo-item"
                    data-status={task.status}
                    className={cn('flex min-h-6 items-start gap-1.5 px-1.5 py-0.5 text-xs', STATUS_CLASS[task.status])}
                  >
                    <Icon aria-hidden="true" strokeWidth={2} className="mt-0.5 size-3 shrink-0" />
                    <span className={cn('min-w-0 flex-1', task.status === 'in_progress' ? 'font-medium text-foreground' : '')}>
                      {task.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** One line above the composer while the agent works through its list: n/m and the task in progress. */
export function TodoStrip({ threadId }: { threadId: string }) {
  const phases = useThreadTodos(threadId);
  const progress = todoProgress(phases);
  if (progress.total === 0 || progress.done === progress.total) return null;
  const current = phases.flatMap((phase) => phase.tasks).find((task) => task.status === 'in_progress');
  return (
    <div
      data-testid="todo-strip"
      className="mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-2 rounded-md px-3 py-1 text-xs text-muted-foreground"
    >
      <CircleDot aria-hidden="true" className="size-3 shrink-0 text-info-foreground" strokeWidth={2} />
      <span className="shrink-0 tabular-nums">
        {progress.done}/{progress.total}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{current?.content ?? 'Next task pending'}</span>
    </div>
  );
}
