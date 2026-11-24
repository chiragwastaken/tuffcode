import type { Thread, ThreadEventRow } from '@tuffcode/contracts';
import { EmptyState, StatusDot } from '@tuffcode/ui';
import { MessagesSquare } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../../store/app-store';
import { Composer } from './Composer';
import { groupTimeline } from './grouping';
import { useApprovalDecisions, useLocalUserMessages } from './local-messages';
import { Timeline } from './Timeline';
import { useThreadStream } from './use-thread-stream';

const EMPTY_EVENTS: readonly ThreadEventRow[] = [];

export interface ThreadViewProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

export function ThreadView({ threadId, thread, projectName }: ThreadViewProps) {
  useThreadStream(threadId);

  const events = useAppStore((state) => state.events[threadId]);
  const userMessages = useLocalUserMessages(threadId);
  const approvals = useApprovalDecisions();
  const theme = useAppStore((state) => state.settings?.theme ?? 'dark');

  const items = useMemo(
    () => groupTimeline({ events: events ?? EMPTY_EVENTS, userMessages, approvals }),
    [approvals, events, userMessages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="truncate text-xs font-medium">{thread?.title ?? threadId}</span>
        {thread ? <StatusDot status={thread.status} withLabel /> : null}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {thread?.branch ? (
            <span className="truncate font-mono text-2xs text-muted-foreground">
              {thread.branch}
            </span>
          ) : null}
          {projectName ? (
            <span className="truncate text-2xs text-muted-foreground">{projectName}</span>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title={thread ? 'Start the conversation' : 'Thread not loaded'}
              description={
                thread
                  ? 'Ask for a change. Type / for commands and $ for skills.'
                  : 'This thread is not in the local cache. Reopen it from the sidebar.'
              }
              className="w-full max-w-md"
            />
          </div>
        ) : (
          <Timeline items={items} theme={theme} threadId={threadId} />
        )}

        <Composer thread={thread} />
      </div>
    </div>
  );
}
