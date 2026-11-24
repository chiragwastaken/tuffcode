import type { Thread } from '@tuffcode/contracts';
import { EmptyState } from '@tuffcode/ui';
import {
  Bot,
  Brain,
  FileDiff,
  MessagesSquare,
  SquareTerminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { RefObject } from 'react';
import { useAppStore } from '../../store/app-store';
import { DiffPanel } from '../diff/DiffPanel';
import { BrainPanel } from '../inspector/BrainPanel';
import { CouncilPanel } from '../inspector/CouncilPanel';
import { SubagentPane } from '../subagents/SubagentPane';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { ThreadView } from '../thread/ThreadView';
import { type PaneSurface } from './pane-model';

export const PANE_SURFACE_ICON: Record<PaneSurface, LucideIcon> = {
  thread: MessagesSquare,
  diff: FileDiff,
  terminal: SquareTerminal,
  brain: Brain,
  council: Users,
  subagent: Bot,
};

export interface PaneSurfaceViewProps {
  surface: PaneSurface;
  threadId: string;
  thread?: Thread;
  projectName?: string;
  /** Shared with the thread surface so a subagent pane can draw its connector. */
  threadStageRef: RefObject<HTMLDivElement | null>;
  /** The row already hosts a subagent surface, so the thread keeps cards only. */
  externalSubagentPane: boolean;
  onOpenInTerminal(path: string): void;
  onCloseSubagent(): void;
}

/**
 * One pane surface. Every branch is the shipped panel, not a copy: the thread
 * timeline, diff review, terminal, brain graph, council board and subagent pane.
 */
export function PaneSurfaceView({
  surface,
  threadId,
  thread,
  projectName,
  threadStageRef,
  externalSubagentPane,
  onOpenInTerminal,
  onCloseSubagent,
}: PaneSurfaceViewProps) {
  switch (surface) {
    case 'thread':
      return (
        <ThreadView
          threadId={threadId}
          thread={thread}
          projectName={projectName}
          stageRef={threadStageRef}
          externalSubagentPane={externalSubagentPane}
        />
      );
    case 'diff':
      return <DiffPanel threadId={threadId} onOpenInTerminal={onOpenInTerminal} />;
    case 'terminal':
      return <TerminalPanel threadId={threadId} />;
    case 'brain':
      return <BrainPanel threadId={threadId} projectId={thread?.projectId ?? null} />;
    case 'council':
      return <CouncilPanel threadId={threadId} />;
    case 'subagent':
      return (
        <SubagentSurface threadId={threadId} stageRef={threadStageRef} onClose={onCloseSubagent} />
      );
  }
}

interface SubagentSurfaceProps {
  threadId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  onClose(): void;
}

/** The subagent pane fills its split pane instead of docking to the thread row. */
function SubagentSurface({ threadId, stageRef, onClose }: SubagentSurfaceProps) {
  const hasChild = useAppStore((state) =>
    Object.values(state.subagents).some((child) => child.threadId === threadId),
  );
  const theme = useAppStore((state) => state.settings?.theme ?? 'dark');
  const selectSubagent = useAppStore((state) => state.selectSubagent);

  if (!hasChild) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          title="No subagent yet"
          description="Spawn a subagent from the composer and its timeline appears here."
          className="w-full max-w-sm"
        />
      </div>
    );
  }

  return (
    <SubagentPane
      threadId={threadId}
      stageRef={stageRef}
      theme={theme}
      onSelect={selectSubagent}
      onClose={onClose}
      variant="pane"
    />
  );
}
