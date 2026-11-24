import { EmptyState, TabsList, TabsPanel, TabsRoot, TabsTab } from '@tuffcode/ui';
import { useReducer } from 'react';
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
} from './inspector-tabs';

export interface InspectorPanelProps {
  /** The open thread, or null on settings and empty workspace routes. */
  threadId: string | null;
  /** False when the shell collapsed the panel; tab state survives the collapse. */
  open: boolean;
}

/**
 * Right panel: diff, terminal, brain and council for the open thread. The tab
 * choice is remembered per thread for the session, and new threads inherit the
 * last tab used anywhere.
 */
export function InspectorPanel({ threadId, open }: InspectorPanelProps) {
  const [tabs, dispatch] = useReducer(inspectorTabsReducer, initialInspectorTabs);
  const thread = useAppStore((state) => (threadId === null ? undefined : state.threads[threadId]));
  const activeTab = tabForThread(tabs, threadId);

  if (threadId === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[var(--row-height)] shrink-0 items-center border-b border-border px-3">
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Inspector
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            title="No thread open"
            description="Open a thread to inspect its diff, terminal, brain context and council goals."
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
      <div className="flex h-[var(--row-height)] shrink-0 items-center border-b border-border px-2">
        <TabsList aria-label="Inspector sections" className="w-full">
          {INSPECTOR_TABS.map((tab) => (
            <TabsTab
              key={tab}
              value={tab}
              data-testid={`inspector-tab-${tab}`}
              className="flex-1 justify-center"
            >
              {INSPECTOR_TAB_LABEL[tab]}
            </TabsTab>
          ))}
        </TabsList>
      </div>

      {open ? (
        <>
          <TabsPanel value="diff" className="min-h-0 flex-1">
            <DiffPanel threadId={threadId} />
          </TabsPanel>
          <TabsPanel value="terminal" className="min-h-0 flex-1">
            <TerminalPanel threadId={threadId} />
          </TabsPanel>
          <TabsPanel value="brain" className="min-h-0 flex-1">
            <BrainPanel threadId={threadId} projectId={thread?.projectId ?? null} />
          </TabsPanel>
          <TabsPanel value="council" className="min-h-0 flex-1">
            <CouncilPanel key={threadId} threadId={threadId} />
          </TabsPanel>
        </>
      ) : null}
    </TabsRoot>
  );
}
