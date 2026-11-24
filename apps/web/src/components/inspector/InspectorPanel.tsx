import { EmptyState, IconButton, TabsList, TabsPanel, TabsRoot, TabsTab } from '@tuffcode/ui';
import { PanelRightClose } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { DiffPanel } from '../diff/DiffPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { BrainPanel } from './BrainPanel';
import { CouncilPanel } from './CouncilPanel';
import {
  INSPECTOR_TABS,
  INSPECTOR_TAB_LABEL,
  initialInspectorTabs,
  inspectorTabsReducer,
  isInspectorTab,
  tabForThread,
  type InspectorTab,
} from './inspector-tabs';

export interface InspectorPanelProps {
  /** The open thread, or null on settings and empty workspace routes. */
  threadId: string | null;
  /** Hides the inspector column. The collapse control renders only when provided. */
  onCollapse?: () => void;
}

/**
 * Right panel: diff, terminal, brain and council for the open thread. The tab
 * choice is remembered per thread for the session, and new threads inherit the
 * last tab used anywhere.
 */
export function InspectorPanel({ threadId, onCollapse }: InspectorPanelProps) {
  const [tabs, dispatch] = useReducer(inspectorTabsReducer, initialInspectorTabs);
  const thread = useAppStore((state) => (threadId === null ? undefined : state.threads[threadId]));
  const activeTab = tabForThread(tabs, threadId);

  if (threadId === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <InspectorHeader title="Inspector" onCollapse={onCollapse} />
        <div className="flex flex-1 items-center justify-center px-3">
          <EmptyState
            variant="inline"
            title="Open a thread to inspect its diff, terminal, brain and council."
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <TabsRoot
      value={activeTab}
      onValueChange={(value) => {
        if (isInspectorTab(value)) dispatch({ type: 'select', threadId, tab: value });
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <InspectorHeader title={thread?.title ?? 'Inspector'} showTabs onCollapse={onCollapse} />

      <InspectorTabs
        key={threadId}
        threadId={threadId}
        projectId={thread?.projectId ?? null}
        activeTab={activeTab}
      />
    </TabsRoot>
  );
}

interface InspectorHeaderProps {
  /** Thread title, or the section name when no thread is open. */
  title: string;
  /** Renders the section tabs; only valid inside the panel's `TabsRoot`. */
  showTabs?: boolean;
  onCollapse?: () => void;
}

/**
 * One header for every inspector state: the thread title, the section tabs and a
 * collapse control. Tabs render inside the panel's `TabsRoot`.
 */
function InspectorHeader({ title, showTabs = false, onCollapse }: InspectorHeaderProps) {
  return (
    <div
      data-testid="inspector-header"
      className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border pr-2 pl-3"
    >
      <span
        data-testid="inspector-title"
        title={title}
        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
      >
        {title}
      </span>
      {showTabs ? (
        <TabsList aria-label="Inspector sections" className="shrink-0">
          {INSPECTOR_TABS.map((tab) => (
            <TabsTab key={tab} value={tab} data-testid={`inspector-tab-${tab}`} className="px-2">
              {INSPECTOR_TAB_LABEL[tab]}
            </TabsTab>
          ))}
        </TabsList>
      ) : null}
      {onCollapse ? (
        <IconButton
          icon={PanelRightClose}
          label="Collapse inspector"
          size="sm"
          className="shrink-0"
          data-testid="inspector-collapse"
          onClick={onCollapse}
        />
      ) : null}
    </div>
  );
}

interface InspectorTabsProps {
  threadId: string;
  projectId: string | null;
  activeTab: InspectorTab;
}

/**
 * Panels stay mounted once visited so a tab switch does not close the thread's
 * terminal or drop an unsaved comment. A panel is not mounted until its tab is
 * first shown, so opening a thread never spawns a shell the user did not ask for.
 */
function InspectorTabs({ threadId, projectId, activeTab }: InspectorTabsProps) {
  const [mountedTabs, setMountedTabs] = useState<readonly InspectorTab[]>([activeTab]);

  useEffect(() => {
    setMountedTabs((current) => (current.includes(activeTab) ? current : [...current, activeTab]));
  }, [activeTab]);

  const isMounted = (tab: InspectorTab): boolean => mountedTabs.includes(tab);

  return (
    <>
      <TabsPanel value="diff" keepMounted className="min-h-0 flex-1">
        {isMounted('diff') ? <DiffPanel threadId={threadId} /> : null}
      </TabsPanel>
      <TabsPanel value="terminal" keepMounted className="min-h-0 flex-1">
        {isMounted('terminal') ? <TerminalPanel threadId={threadId} /> : null}
      </TabsPanel>
      <TabsPanel value="brain" keepMounted className="min-h-0 flex-1">
        {isMounted('brain') ? <BrainPanel threadId={threadId} projectId={projectId} /> : null}
      </TabsPanel>
      <TabsPanel value="council" keepMounted className="min-h-0 flex-1">
        {isMounted('council') ? <CouncilPanel threadId={threadId} /> : null}
      </TabsPanel>
    </>
  );
}
