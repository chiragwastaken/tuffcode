import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import { THREAD_MENU, type ActionContext } from '../actions';
import { useActionPorts } from '../menu/action-context';
import { useContextMenuTrigger } from '../menu/Menu';
import { StatusChip } from '../thread/status-chip';
import { formatRelativeTime } from './sidebar-model';

export interface ThreadRowProps {
  thread: Thread;
  selected: boolean;
  /** The project root, used by Copy path when the thread has no worktree. */
  projectPath?: string;
  onSelect: (threadId: string) => void;
  onOpen: (thread: Thread) => void;
  onRename: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
}

/**
 * One 34px thread row: the title truncates across the full width on its own
 * line, and an 11px line beneath it pairs the status chip with the relative
 * update time. The native tooltip carries the untruncated title.
 */
export function ThreadRow({
  thread,
  selected,
  projectPath,
  onSelect,
  onOpen,
  onRename,
  onDelete,
}: ThreadRowProps) {
  const title = thread.title.trim() === '' ? 'Untitled thread' : thread.title;
  const updated = formatRelativeTime(thread.updatedAt);
  const ports = useActionPorts();
  const context: ActionContext = {
    ...ports,
    thread,
    projectPath,
    ui: { openThread: onOpen, renameThread: onRename, deleteThread: onDelete },
  };
  const menuProps = useContextMenuTrigger(THREAD_MENU, context, { label: 'Thread actions' });

  return (
    <Link
      data-testid="thread-row"
      data-thread-id={thread.id}
      to="/project/$projectId/thread/$threadId"
      params={{ projectId: thread.projectId, threadId: thread.id }}
      onClick={() => onSelect(thread.id)}
      aria-current={selected ? 'page' : undefined}
      title={title}
      {...menuProps}
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
