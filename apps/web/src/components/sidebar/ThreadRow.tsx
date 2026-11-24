import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import { StatusChip } from '../thread/status-chip';
import { formatRelativeTime } from './sidebar-model';

export interface ThreadRowProps {
  thread: Thread;
  selected: boolean;
  onSelect: (threadId: string) => void;
}

/**
 * One 34px thread row: the title truncates across the full width on its own
 * line, and an 11px line beneath it pairs the status chip with the relative
 * update time. The native tooltip carries the untruncated title.
 */
export function ThreadRow({ thread, selected, onSelect }: ThreadRowProps) {
  const title = thread.title.trim() === '' ? 'Untitled thread' : thread.title;
  const updated = formatRelativeTime(thread.updatedAt);

  return (
    <Link
      data-testid="thread-row"
      data-thread-id={thread.id}
      to="/project/$projectId/thread/$threadId"
      params={{ projectId: thread.projectId, threadId: thread.id }}
      onClick={() => onSelect(thread.id)}
      aria-current={selected ? 'page' : undefined}
      title={title}
      className={cn(
        'flex h-[34px] flex-col justify-center gap-0.5 rounded-md px-2',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-active text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <span className="min-w-0 w-full truncate text-xs leading-4">{title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-2xs leading-none">
        <StatusChip status={thread.status} className="h-3.5 px-1" />
        {updated === '' ? null : (
          <time dateTime={thread.updatedAt} className="ml-auto shrink-0 tabular-nums">
            {updated}
          </time>
        )}
      </span>
    </Link>
  );
}
