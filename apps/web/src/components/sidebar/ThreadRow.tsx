import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { Badge, STATUS_TEXT_CLASS, StatusDot, cn } from '@tuffcode/ui';
import { threadStatusBadge } from './sidebar-model';

export interface ThreadRowProps {
  thread: Thread;
  selected: boolean;
  onSelect: (threadId: string) => void;
}

/** One 36px thread row: status dot, title, and a live badge for loud statuses. */
export function ThreadRow({ thread, selected, onSelect }: ThreadRowProps) {
  const badge = threadStatusBadge(thread.status);
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
        'flex h-[var(--row-height)] items-center gap-2 rounded-md px-2 text-xs',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-selected text-sidebar-foreground'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <StatusDot status={thread.status} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {badge ? (
        <Badge
          variant="outline"
          size="sm"
          className={cn('border-transparent px-1', STATUS_TEXT_CLASS[badge.tone])}
        >
          {badge.label}
        </Badge>
      ) : null}
    </Link>
  );
}
