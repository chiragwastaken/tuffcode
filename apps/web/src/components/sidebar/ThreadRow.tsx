import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import { StatusChip } from '../thread/status-chip';

export interface ThreadRowProps {
  thread: Thread;
  selected: boolean;
  onSelect: (threadId: string) => void;
}

/**
 * One 44px thread row. The title owns the full width on its own line and the
 * status chip sits beneath it, so a wide chip never squeezes the title.
 */
export function ThreadRow({ thread, selected, onSelect }: ThreadRowProps) {
  const title = thread.title.trim() === '' ? 'Untitled thread' : thread.title;

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
        'flex h-11 flex-col justify-center gap-0.5 rounded-md px-2.5 py-1',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-active text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <span className="min-w-0 truncate text-xs">{title}</span>
      <StatusChip status={thread.status} className="self-start" />
    </Link>
  );
}
