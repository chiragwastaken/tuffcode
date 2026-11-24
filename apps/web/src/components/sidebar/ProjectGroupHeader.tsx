import type { Project } from '@tuffcode/contracts';
import { IconButton, cn } from '@tuffcode/ui';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';

const revealOnHover = cn(
  'opacity-0 pointer-events-none transition-opacity duration-150',
  'group-hover/project:pointer-events-auto group-hover/project:opacity-100',
  'focus-visible:pointer-events-auto focus-visible:opacity-100',
);

export interface ProjectGroupHeaderProps {
  project: Project;
  threadCount: number;
  collapsed: boolean;
  creating: boolean;
  onToggle: (projectId: string) => void;
  onNewThread: (projectId: string) => void;
  onRemove: (project: Project) => void;
}

/** Project row that collapses its threads and owns the per-project actions. */
export function ProjectGroupHeader({
  project,
  threadCount,
  collapsed,
  creating,
  onToggle,
  onNewThread,
  onRemove,
}: ProjectGroupHeaderProps) {
  return (
    <div className="group/project flex h-8 items-center gap-0.5 border-t border-sidebar-border px-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(project.id)}
        title={project.path}
        className={cn(
          'flex h-6 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left',
          'text-sidebar-muted-foreground hover:text-sidebar-foreground',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-150',
            collapsed ? null : 'rotate-90',
          )}
        />
        <span
          data-testid="project-name"
          className="truncate text-2xs font-medium tracking-wide uppercase"
        >
          {project.name}
        </span>
      </button>

      <span className="shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground">
        {threadCount}
      </span>

      <IconButton
        icon={Plus}
        label={`New thread in ${project.name}`}
        size="sm"
        disabled={creating}
        onClick={() => onNewThread(project.id)}
        className={cn(revealOnHover, 'disabled:opacity-0')}
      />
      <IconButton
        icon={Trash2}
        label={`Remove ${project.name}`}
        size="sm"
        onClick={() => onRemove(project)}
        className={revealOnHover}
      />
    </div>
  );
}
