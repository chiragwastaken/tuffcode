import { Link } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { cn } from '@tuffcode/ui';
import {
  ListTree,
  MessagesSquare,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { THREAD_MENU, type ActionContext } from '../actions';
import { useActionPorts } from '../menu/action-context';
import { useContextMenuTrigger } from '../menu/Menu';
import { SUBAGENT_TYPE_ICON } from '../subagents/subagent-model';
import { StatusChip } from '../thread/status-chip';
import { elapsedMs, formatDuration } from '../thread/turn-blocks';
import {
  childSubagentType,
  childThreadKind,
  childThreadLabel,
  formatRelativeTime,
  type ChildThreadKind,
} from './sidebar-model';

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
 * One 48px thread row: the title truncates across the full width on its own
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
        'flex h-12 flex-col justify-center gap-1 rounded-md px-2 py-1',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-active text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <span className="min-w-0 w-full truncate text-[13px] leading-5">{title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none">
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

export interface ChildThreadRowProps {
  thread: Thread;
  parentId: string;
  selected: boolean;
  onOpen: (thread: Thread, parentId: string) => void;
}

const CHILD_KIND_ICON: Record<ChildThreadKind, LucideIcon> = {
  subagent: MessagesSquare,
  council: Users,
  plan: ListTree,
  review: ShieldCheck,
  thread: MessagesSquare,
};

function childIcon(thread: Thread): LucideIcon {
  const type = childSubagentType(thread);
  if (type !== null) return SUBAGENT_TYPE_ICON[type];
  return CHILD_KIND_ICON[childThreadKind(thread)];
}

/**
 * One 44px child row nested under its root thread: a type icon, the short label,
 * then the status chip and how long the child thread has been alive.
 */
export function ChildThreadRow({ thread, parentId, selected, onOpen }: ChildThreadRowProps) {
  const label = childThreadLabel(thread);
  const Icon = childIcon(thread);
  const elapsed = formatDuration(elapsedMs(thread.createdAt, thread.updatedAt));

  return (
    <button
      type="button"
      data-testid="thread-child-row"
      data-thread-id={thread.id}
      onClick={() => onOpen(thread, parentId)}
      aria-current={selected ? 'page' : undefined}
      title={label}
      className={cn(
        'flex h-11 w-full min-w-0 flex-col justify-center gap-1 rounded-md pr-2 pl-6 py-1 text-left',
        'transition-colors duration-150',
        selected
          ? 'bg-sidebar-row-active text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4">{label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-[18px] text-[11px] leading-none">
        <StatusChip status={thread.status} className="h-3.5 px-1" />
        {elapsed === '' ? null : (
          <time dateTime={thread.updatedAt} className="ml-auto shrink-0 tabular-nums">
            {elapsed}
          </time>
        )}
      </span>
    </button>
  );
}
