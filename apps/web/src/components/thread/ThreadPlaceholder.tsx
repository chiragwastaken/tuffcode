import type { Thread } from '@tuffcode/contracts';
import { Button, EmptyState, StatusDot, Textarea } from '@tuffcode/ui';
import { MessagesSquare } from 'lucide-react';

export interface ThreadPlaceholderProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

export function ThreadPlaceholder({ threadId, thread, projectName }: ThreadPlaceholderProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="truncate text-xs font-medium">{thread?.title ?? threadId}</span>
        {thread ? <StatusDot status={thread.status} withLabel /> : null}
        {projectName ? (
          <span className="ml-auto truncate text-2xs text-muted-foreground">{projectName}</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          icon={MessagesSquare}
          title={thread ? 'Thread timeline' : 'Thread not loaded'}
          description={
            thread
              ? 'Messages, tool calls, and approvals will render here once the timeline slice lands.'
              : 'This thread is not in the local cache. Reopen it from the sidebar.'
          }
          className="w-full max-w-md"
        />
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mx-auto w-full max-w-[var(--chat-content-max-width)] rounded-xl border border-border bg-message-surface/60 p-2">
          <Textarea
            disabled
            rows={2}
            aria-label="Thread composer"
            placeholder="Composer arrives in a later slice."
            className="min-h-0 border-0 bg-transparent"
          />
          <div className="flex items-center justify-end">
            <Button size="sm" disabled>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
