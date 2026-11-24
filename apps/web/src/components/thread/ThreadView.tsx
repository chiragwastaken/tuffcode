import { Link } from '@tanstack/react-router';
import type { ExecutionMode, Thread, ThreadEventRow } from '@tuffcode/contracts';
import { Button, EmptyState, buttonVariants } from '@tuffcode/ui';
import { FolderOpen, GitBranch, MessagesSquare } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/app-store';
import { runAction, type ActionContext } from '../actions';
import { useActionPorts } from '../menu/action-context';
import { Composer } from './Composer';
import { groupTimeline, type UserItem } from './grouping';
import { useApprovalDecisions, useLocalUserMessages, useSupersededTurns } from './local-messages';
import { StatusChip } from './status-chip';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import { Timeline } from './Timeline';
import { useThreadStream } from './use-thread-stream';

const EMPTY_EVENTS: readonly ThreadEventRow[] = [];

const THREAD_MODES: readonly SegmentedOption<'work' | 'council'>[] = [
  { value: 'work', label: 'Work' },
  { value: 'council', label: 'Council' },
];

function focusComposer(): void {
  const input =
    document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]') ??
    document.querySelector<HTMLTextAreaElement>('[data-testid="council-goal-input"]');
  input?.focus();
}

export interface ThreadViewProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

export function ThreadView({ threadId, thread, projectName }: ThreadViewProps) {
  useThreadStream(threadId);

  const ports = useActionPorts();
  const events = useAppStore((state) => state.events[threadId]);
  const messages = useAppStore((state) => state.messages[threadId]);
  const upsertThread = useAppStore((state) => state.upsertThread);
  const userMessages = useLocalUserMessages(threadId);
  const approvals = useApprovalDecisions();
  const supersededTurns = useSupersededTurns(threadId);
  const theme = useAppStore((state) => state.settings?.theme ?? 'dark');
  const [switchingMode, setSwitchingMode] = useState(false);

  const items = useMemo(
    () =>
      groupTimeline({
        events: events ?? EMPTY_EVENTS,
        messages: messages ?? [],
        userMessages,
        approvals,
        supersededTurns,
      }),
    [approvals, events, messages, supersededTurns, userMessages],
  );

  const runMessageAction = useCallback(
    (id: 'message.retry' | 'message.edit', item: UserItem, input?: { text: string }) => {
      const context: ActionContext = {
        ...ports,
        threadId,
        userMessage: item,
        ...(input === undefined ? {} : { input }),
      };
      void Promise.resolve(runAction(id, context)).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not send the message.');
      });
    },
    [ports, threadId],
  );

  const retryUserMessage = useCallback(
    (item: UserItem) => runMessageAction('message.retry', item),
    [runMessageAction],
  );

  const editUserMessage = useCallback(
    (item: UserItem, text: string) => runMessageAction('message.edit', item, { text }),
    [runMessageAction],
  );

  const title = thread?.title ?? threadId;

  async function setThreadMode(mode: ExecutionMode): Promise<void> {
    if (!thread || thread.executionMode === mode) return;
    setSwitchingMode(true);
    try {
      upsertThread(await rpc.request('threads.update', { id: thread.id, executionMode: mode }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch the thread mode.');
    } finally {
      setSwitchingMode(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="@container sticky top-0 z-20 grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {projectName ? (
            <span className="hidden min-w-0 items-center gap-1.5 text-2xs text-muted-foreground @min-[44rem]:flex">
              <FolderOpen aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate" title={projectName}>
                {projectName}
              </span>
            </span>
          ) : null}
          {projectName ? (
            <span
              aria-hidden="true"
              className="hidden text-muted-foreground/40 @min-[44rem]:inline"
            >
              /
            </span>
          ) : null}
          <span
            data-testid="thread-title"
            className="min-w-0 truncate text-sm font-medium"
            title={title}
          >
            {title}
          </span>
          {thread ? (
            <span data-testid="thread-status" data-status={thread.status} className="inline-flex">
              <StatusChip status={thread.status} />
            </span>
          ) : null}
        </div>

        <div className="flex justify-center">
          {thread ? (
            <SegmentedControl
              ariaLabel="Thread mode"
              testId="thread-mode-switch"
              size="md"
              value={thread.executionMode === 'council' ? 'council' : 'work'}
              options={THREAD_MODES}
              disabled={switchingMode}
              onValueChange={(mode) => void setThreadMode(mode)}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {thread?.branch ? (
            <span
              className="flex min-w-0 items-center gap-1 font-mono text-2xs text-muted-foreground"
              title={thread.branch}
            >
              <GitBranch aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
              <span className="truncate">{thread.branch}</span>
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {thread ? (
              <EmptyState
                icon={MessagesSquare}
                title="Start the conversation"
                action={
                  <Button size="sm" variant="secondary" onClick={focusComposer}>
                    Write a message
                  </Button>
                }
                className="w-full max-w-md"
              />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title="Thread not loaded"
                action={
                  <Link to="/" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                    Back to projects
                  </Link>
                }
                className="w-full max-w-md"
              />
            )}
          </div>
        ) : (
          <Timeline
            items={items}
            theme={theme}
            threadId={threadId}
            onRetryUserMessage={retryUserMessage}
            onEditUserMessage={editUserMessage}
          />
        )}

        <Composer thread={thread} />
      </div>
    </div>
  );
}
