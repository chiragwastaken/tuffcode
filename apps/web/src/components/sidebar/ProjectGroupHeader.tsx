import type { Project } from '@tuffcode/contracts';
import { IconButton, cn } from '@tuffcode/ui';
import { ChevronRight, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react';

const revealOnHover = cn(
  'opacity-0 pointer-events-none transition-opacity duration-150',
  'group-hover/project:pointer-events-auto group-hover/project:opacity-100',
  'focus-visible:pointer-events-auto focus-visible:opacity-100',
);

const compactIcon = 'size-6 [&_svg]:size-3';

export interface ProjectGroupHeaderProps {
  project: Project;
  threadCount: number;
  collapsed: boolean;
  creating: boolean;
  onToggle: (projectId: string) => void;
  onNewThread: (projectId: string) => void;
  onRemove: (project: Project) => void;
}

/** 30px project row: folder, name, branch, thread count, and its actions. */
export function ProjectGroupHeader({
  project,
  threadCount,
  collapsed,
  creating,
  onToggle,
  onNewThread,
  onRemove,
}: ProjectGroupHeaderProps) {
  const FolderIcon = collapsed ? Folder : FolderOpen;

  return (
    <div className="group/project flex h-[30px] items-center gap-0.5 border-t border-sidebar-border px-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(project.id)}
        title={project.path}
        className={cn(
          'flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 text-left',
          'hover:bg-sidebar-row-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3 shrink-0 text-sidebar-muted-foreground transition-transform duration-150',
            collapsed ? null : 'rotate-90',
          )}
        />
        <FolderIcon
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-sidebar-muted-foreground"
        />
        <span
          data-testid="project-name"
          className="min-w-0 truncate text-xs font-medium text-sidebar-foreground"
        >
          {project.name}
        </span>
        <span
          className="min-w-0 max-w-24 truncate font-mono text-2xs text-sidebar-muted-foreground"
          title={project.defaultBranch}
        >
          {project.defaultBranch}
        </span>
      </button>

      <span className="shrink-0 px-1 text-2xs tabular-nums text-sidebar-muted-foreground">
        {threadCount}
      </span>

      <IconButton
        data-testid="sidebar-new-thread"
        icon={Plus}
        label={`New thread in ${project.name}`}
        size="sm"
        disabled={creating}
        onClick={() => onNewThread(project.id)}
        className={compactIcon}
      />
      <IconButton
        icon={Trash2}
        label={`Remove ${project.name}`}
        size="sm"
        onClick={() => onRemove(project)}
        className={cn(compactIcon, revealOnHover)}
      />
    </div>
  );
}
