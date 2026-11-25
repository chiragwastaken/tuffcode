import { IconButton, PopoverClose, PopoverContent, PopoverRoot, PopoverTrigger, buttonVariants, cn } from '@tuffcode/ui';
import {
  Brain,
  Columns2,
  FileDiff,
  FolderTree,
  Globe,
  ListTree,
  MessageSquarePlus,
  Plus,
  SquareTerminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import type { InspectorTab } from '../inspector/inspector-tabs';
import { requestPane } from '../panes/pane-requests';

export interface DockToolbarProps {
  threadId: string;
  activeTab: InspectorTab | null;
  openTabs: readonly InspectorTab[];
  onToggle: (tab: InspectorTab) => void;
  onOpen: (tab: InspectorTab) => void;
}

const TOGGLES: { tab: InspectorTab; icon: LucideIcon; label: string }[] = [
  { tab: 'activity', icon: ListTree, label: 'Activity' },
  { tab: 'terminal', icon: SquareTerminal, label: 'Terminal' },
  { tab: 'diff', icon: FileDiff, label: 'Changes' },
  { tab: 'browser', icon: Globe, label: 'Browser' },
  { tab: 'files', icon: FolderTree, label: 'Files' },
];

/**
 * The thread's top-right toolbar: one toggle per dock panel and a `+` menu for the
 * rest (a new terminal or browser tab, a side chat with another thread, a split view
 * of a tool surface). Nothing opens until the user asks, so the conversation owns the
 * window by default.
 */
export function DockToolbar({ threadId, activeTab, openTabs, onToggle, onOpen }: DockToolbarProps) {
  const thread = useAppStore((state) => state.threads[threadId]);
  const browserEnabled = useAppStore((state) => state.settings?.capabilities.browser ?? true);
  const threadsById = useAppStore((state) => state.threads);
  const [picking, setPicking] = useState(false);
  const council = thread?.executionMode === 'council';

  const sideChats = useMemo(
    () =>
      Object.values(threadsById)
        .filter((entry) => entry.id !== threadId && entry.parentThreadId === null)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12),
    [threadId, threadsById],
  );

  const toggles = TOGGLES.filter((entry) => entry.tab !== 'browser' || browserEnabled);

  return (
    <div data-testid="dock-toolbar" className="no-drag flex shrink-0 items-center gap-0.5">
      {toggles.map(({ tab, icon, label }) => (
        <IconButton
          key={tab}
          icon={icon}
          label={openTabs.includes(tab) && activeTab === tab ? `Hide ${label}` : `Show ${label}`}
          size="sm"
          aria-pressed={activeTab === tab}
          data-testid={`dock-toggle-${tab}`}
          className={cn(activeTab === tab ? 'bg-accent text-foreground' : '')}
          onClick={() => onToggle(tab)}
        />
      ))}
      <PopoverRoot onOpenChange={(open) => (open ? undefined : setPicking(false))}>
        <PopoverTrigger
          aria-label="Open a panel or view"
          data-testid="dock-add-menu"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <Plus strokeWidth={1.75} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          {picking ? (
            <div className="flex flex-col" data-testid="dock-side-chat-list">
              <p className="px-2 py-1.5 text-2xs text-muted-foreground">Open beside this chat</p>
              {sideChats.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No other chats yet.</p>
              ) : (
                sideChats.map((entry) => (
                  <PopoverClose
                    key={entry.id}
                    className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs text-foreground hover:bg-accent"
                    onClick={() => requestPane({ kind: 'side-chat', threadId: entry.id })}
                  >
                    <span className="truncate" title={entry.title}>
                      {entry.title}
                    </span>
                  </PopoverClose>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col" data-testid="dock-add-items">
              <MenuItem icon={SquareTerminal} label="Terminal" testId="dock-add-terminal" onClick={() => onOpen('terminal')} />
              {browserEnabled ? (
                <MenuItem icon={Globe} label="New browser tab" testId="dock-add-browser" onClick={() => onOpen('browser')} />
              ) : null}
              <MenuItem icon={FolderTree} label="Files" testId="dock-add-files" onClick={() => onOpen('files')} />
              <MenuItem icon={Brain} label="Brain" testId="dock-add-brain" onClick={() => onOpen('brain')} />
              {council ? <MenuItem icon={Users} label="Council board" testId="dock-add-council" onClick={() => onOpen('council')} /> : null}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                data-testid="dock-add-side-chat"
                onClick={() => setPicking(true)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-accent"
              >
                <MessageSquarePlus className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                Side chat
              </button>
              <MenuItem
                icon={Columns2}
                label="Split view with changes"
                testId="dock-add-split"
                onClick={() => requestPane({ kind: 'split', surface: 'diff' })}
              />
            </div>
          )}
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <PopoverClose
      data-testid={testId}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-accent"
    >
      <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
      {label}
    </PopoverClose>
  );
}
