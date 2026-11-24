import { Link } from '@tanstack/react-router';
import type { Thread, ThreadEventRow } from '@tuffcode/contracts';
import { Button, EmptyState, buttonVariants } from '@tuffcode/ui';
import { FolderOpen, GitBranch, MessagesSquare } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { Composer } from './Composer';
import { groupTimeline, type UserItem } from './grouping';
import {
  failLocalUserMessage,
  resolveLocalUserMessage,
  retryLocalUserMessage,
  useApprovalDecisions,
  useLocalUserMessages,
} from './local-messages';
import { StatusChip } from './status-chip';
import { Timeline } from './Timeline';
import { useThreadStream } from './use-thread-stream';

const EMPTY_EVENTS: readonly ThreadEventRow[] = [];

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
}

export interface ThreadViewProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

export function ThreadView({ threadId, thread, projectName }: ThreadViewProps) {
  useThreadStream(threadId);

  const rpc = useRpc();
  const events = useAppStore((state) => state.events[threadId]);
  const messages = useAppStore((state) => state.messages[threadId]);
  const userMessages = useLocalUserMessages(threadId);
  const approvals = useApprovalDecisions();
  const theme = useAppStore((state) => state.settings?.theme ?? 'dark');

  const items = useMemo(
    () =>
      groupTimeline({
        events: events ?? EMPTY_EVENTS,
        messages: messages ?? [],
        userMessages,
        approvals,
      }),
    [approvals, events, messages, userMessages],
  );

  const retryUserMessage = useCallback(
    (item: UserItem) => {
      retryLocalUserMessage(item.messageId);
      void rpc
        .request('threads.send', {
          id: threadId,
          text: item.text,
          ...(item.attachments.length > 0 ? { attachments: item.attachments } : {}),
        })
        .then(
          (result) => resolveLocalUserMessage(item.messageId, result.turnId),
          (error: unknown) => {
            failLocalUserMessage(item.messageId);
            toast.error(error instanceof Error ? error.message : 'Could not send the message.');
          },
        );
    },
    [rpc, threadId],
  );

  const title = thread?.title ?? threadId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-20 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        {projectName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <FolderOpen aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
            <span className="max-w-40 truncate" title={projectName}>
              {projectName}
            </span>
          </span>
        ) : null}
        {projectName ? (
          <span aria-hidden="true" className="text-muted-foreground/40">
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
        {thread?.branch ? (
          <span
            className="ml-auto flex min-w-0 items-center gap-1 font-mono text-2xs text-muted-foreground"
            title={thread.branch}
          >
            <GitBranch aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
            <span className="truncate">{thread.branch}</span>
          </span>
        ) : null}
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
          />
        )}

        <Composer thread={thread} />
      </div>
    </div>
  );
}
