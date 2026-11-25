import type { Project, Thread } from '@tuffcode/contracts';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { ProjectGroupHeader } from './ProjectGroupHeader';
import { ChildThreadRow, ThreadRow } from './ThreadRow';
import {
  SIDEBAR_ITEM_HEIGHT,
  SIDEBAR_ROW_GAP,
  sidebarItemHeight,
  sidebarItemKey,
  type SidebarItem,
} from './sidebar-model';

export interface SidebarItemActions {
  activeThreadId: string | null;
  creatingProjectId: string | null;
  projectPathFor: (projectId: string) => string | undefined;
  onSelectThread: (threadId: string) => void;
  onOpenThread: (thread: Thread) => void;
  onOpenChild: (thread: Thread, parentId: string) => void;
  onRenameThread: (thread: Thread) => void;
  onDeleteThread: (thread: Thread) => void;
  onToggleProject: (projectId: string) => void;
  onNewThread: (projectId: string) => void;
  onRemoveProject: (project: Project) => void;
}

export interface SidebarListProps {
  items: SidebarItem[];
  virtual: boolean;
  actions: SidebarItemActions;
}

export function SidebarList({ items, virtual, actions }: SidebarListProps) {
  if (virtual) {
    return <VirtualSidebarList items={items} actions={actions} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {items.map((item) => (
        <div key={sidebarItemKey(item)} className="px-2 pb-0.5">
          <SidebarItemView item={item} actions={actions} />
        </div>
      ))}
    </div>
  );
}

function VirtualSidebarList({ items, actions }: Omit<SidebarListProps, 'virtual'>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index];
      return item ? sidebarItemHeight(item) + SIDEBAR_ROW_GAP : SIDEBAR_ITEM_HEIGHT.thread;
    },
    getItemKey: (index) => {
      const item = items[index];
      return item ? sidebarItemKey(item) : index;
    },
    overscan: 8,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              className="absolute inset-x-0 top-0 px-2"
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="h-full pb-0.5">
                <SidebarItemView item={item} actions={actions} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidebarItemView({ item, actions }: { item: SidebarItem; actions: SidebarItemActions }) {
  switch (item.kind) {
    case 'project':
      return (
        <ProjectGroupHeader
          project={item.project}
          threadCount={item.threadCount}
          collapsed={item.collapsed}
          creating={actions.creatingProjectId === item.project.id}
          onToggle={actions.onToggleProject}
          onNewThread={actions.onNewThread}
          onRemove={actions.onRemoveProject}
        />
      );
    case 'thread':
      return (
        <ThreadRow
          thread={item.thread}
          selected={item.thread.id === actions.activeThreadId}
          projectPath={actions.projectPathFor(item.thread.projectId)}
          onSelect={actions.onSelectThread}
          onOpen={actions.onOpenThread}
          onRename={actions.onRenameThread}
          onDelete={actions.onDeleteThread}
        />
      );
    case 'child':
      return (
        <ChildThreadRow
          thread={item.thread}
          parentId={item.parentId}
          selected={item.thread.id === actions.activeThreadId}
          onOpen={actions.onOpenChild}
        />
      );
    case 'empty':
      return (
        <p className="flex h-8 items-center px-3 text-xs text-sidebar-muted-foreground">
          No threads yet
        </p>
      );
  }
}
