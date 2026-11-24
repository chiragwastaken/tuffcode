import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import { StatusChip } from '../thread/status-chip';

export interface ThreadRowProps {
  thread: Thread;
  selected: boolean;
  onSelect: (threadId: string) => void;
}

/** One 34px thread row: title, then a single tinted status chip. */
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
        'flex h-[34px] items-center gap-2 rounded-md px-2.5 text-xs',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-active text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <StatusChip status={thread.status} />
    </Link>
  );
}
