import { Link } from '@tanstack/react-router';
import type { ExecutionMode, Thread, ThreadEventRow } from '@tuffcode/contracts';
import { Badge, Button, EmptyState, buttonVariants } from '@tuffcode/ui';
import { Activity, FolderOpen, GitBranch, MessagesSquare, Users, Wrench } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/app-store';
import { runAction, type ActionContext } from '../actions';
import { CouncilThreadBoard } from '../council/CouncilThreadBoard';
import { activityCount } from '../inspector/activity-model';
import { requestInspectorTab } from '../inspector/panel-requests';
import { useActionPorts } from '../menu/action-context';
import { SubagentPane } from '../subagents/SubagentPane';
import { SubagentStrip } from '../subagents/SubagentStrip';
import { useDockInset } from '../subagents/use-dock-inset';
import { useSubagentList } from '../subagents/use-subagents';
import { Composer } from './Composer';
import { groupTimeline, type UserItem } from './grouping';
import { useApprovalDecisions, useLocalUserMessages, useSupersededTurns } from './local-messages';
import { StatusChip } from './status-chip';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import { Timeline } from './Timeline';
import { useThreadStream } from './use-thread-stream';

const EMPTY_EVENTS: readonly ThreadEventRow[] = [];

const THREAD_MODES: readonly SegmentedOption<'work' | 'council'>[] = [
  { value: 'work', label: 'Work', icon: Wrench },
  { value: 'council', label: 'Council', icon: Users },
];

function focusComposer(): void {
  const input =
    document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]') ??
    document.querySelector<HTMLTextAreaElement>('[data-testid="council-goal-input"]');
  input?.focus();
}

export interface ThreadViewProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
  /** Shared with the pane row so a subagent surface can measure its connector. */
  stageRef?: RefObject<HTMLDivElement | null>;
  /** A split pane already hosts the subagent surface; keep the cards, not the pane. */
  externalSubagentPane?: boolean;
}

export function ThreadView({
  threadId,
  thread,
  projectName,
  stageRef: sharedStageRef,
  externalSubagentPane = false,
}: ThreadViewProps) {
  useThreadStream(threadId);
  useSubagentList(threadId);

  const ports = useActionPorts();
  const events = useAppStore((state) => state.events[threadId]);
  const messages = useAppStore((state) => state.messages[threadId]);
  const userMessages = useLocalUserMessages(threadId);
  const approvals = useApprovalDecisions();
  const supersededTurns = useSupersededTurns(threadId);
  const theme = useAppStore((state) => state.settings?.theme ?? 'dark');
  const [switchingMode, setSwitchingMode] = useState(false);

  // Boolean and string selectors only: child frames mutate `subagents` on every
  // token, and this view must not re-render the parent timeline for them.
  const hasSubagents = useAppStore((state) =>
    Object.values(state.subagents).some((child) => child.threadId === threadId),
  );
  const subagentPaneOpen = useAppStore((state) => {
    const pane = state.subagentPane;
    if (!pane.open || pane.activeChildId === null) return false;
    return state.subagents[pane.activeChildId]?.threadId === threadId;
  });
  const activityRunning = useAppStore((state) =>
    activityCount(state.events[threadId] ?? EMPTY_EVENTS, state.subagents, threadId),
  );
  const openSubagent = useAppStore((state) => state.openSubagent);
  const selectSubagent = useAppStore((state) => state.selectSubagent);
  const closeSubagentPane = useAppStore((state) => state.closeSubagentPane);
  const localStageRef = useRef<HTMLDivElement>(null);
  const stageRef = sharedStageRef ?? localStageRef;
  const dockRef = useRef<HTMLDivElement>(null);
  useDockInset(stageRef, dockRef, subagentPaneOpen);

  const items = useMemo(
    () =>
      groupTimeline({
        events: events ?? EMPTY_EVENTS,
        messages: messages ?? [],
        userMessages,
        approvals,
        supersededTurns,
      }),
    [approvals, events, messages, supersededTurns, userMessages],
  );

  const runMessageAction = useCallback(
    (id: 'message.retry' | 'message.edit', item: UserItem, input?: { text: string }) => {
      const context: ActionContext = {
        ...ports,
        threadId,
        userMessage: item,
        ...(input === undefined ? {} : { input }),
      };
      void Promise.resolve(runAction(id, context)).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not send the message.');
      });
    },
    [ports, threadId],
  );

  const retryUserMessage = useCallback(
    (item: UserItem) => runMessageAction('message.retry', item),
    [runMessageAction],
  );

  const editUserMessage = useCallback(
    (item: UserItem, text: string) => runMessageAction('message.edit', item, { text }),
    [runMessageAction],
  );

  const title = thread?.title ?? threadId;

  async function setThreadMode(mode: ExecutionMode): Promise<void> {
    if (!thread || thread.executionMode === mode) return;
    setSwitchingMode(true);
    try {
      ports.store.upsertThread(
        await ports.rpc.request('threads.update', { id: thread.id, executionMode: mode }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch the thread mode.');
    } finally {
      setSwitchingMode(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="@container sticky top-0 z-20 grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {projectName ? (
            <span className="hidden min-w-0 shrink items-center gap-1.5 text-2xs text-muted-foreground @min-[44rem]:flex">
              <FolderOpen aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate" title={projectName}>
                {projectName}
              </span>
            </span>
          ) : null}
          {projectName ? (
            <span
              aria-hidden="true"
              className="hidden text-muted-foreground/40 @min-[44rem]:inline"
            >
              /
            </span>
          ) : null}
          <span
            data-testid="thread-title"
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={title}
          >
            {title}
          </span>
          {thread ? (
            <span
              data-testid="thread-status"
              data-status={thread.status}
              className="inline-flex shrink-0"
            >
              <StatusChip status={thread.status} />
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-center">
          {thread ? (
            <SegmentedControl
              ariaLabel="Thread mode"
              testId="thread-mode-switch"
              size="md"
              value={thread.executionMode === 'council' ? 'council' : 'work'}
              options={THREAD_MODES}
              disabled={switchingMode}
              onValueChange={(mode) => void setThreadMode(mode)}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {thread?.branch ? (
            <span
              className="hidden min-w-0 shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground min-[1500px]:flex"
              title={thread.branch}
            >
              <GitBranch aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
              <span className="max-w-56 truncate">{thread.branch}</span>
            </span>
          ) : null}
          <ActivityButton
            count={activityRunning}
            onOpen={() => requestInspectorTab('activity')}
          />
        </div>
      </header>

      <div
        ref={stageRef}
        data-subagent-stage
        className="@container relative flex min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {items.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              {thread === undefined ? (
                <EmptyState
                  icon={MessagesSquare}
                  title="Thread not loaded"
                  action={
                    <Link to="/" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                      Back to projects
                    </Link>
                  }
                  className="w-full max-w-md"
                />
              ) : thread.executionMode === 'council' ? null : (
                <EmptyState
                  icon={MessagesSquare}
                  title="Start the conversation"
                  action={
                    <Button size="sm" variant="secondary" onClick={focusComposer}>
                      Write a message
                    </Button>
                  }
                  className="w-full max-w-md"
                />
              )}
            </div>
          ) : (
            <Timeline
              items={items}
              theme={theme}
              threadId={threadId}
              onRetryUserMessage={retryUserMessage}
              onEditUserMessage={editUserMessage}
            />
          )}

          {thread?.executionMode === 'council' ? (
            <CouncilThreadBoard threadId={threadId} />
          ) : null}

          <div ref={dockRef} className="flex shrink-0 flex-col">
            {hasSubagents ? <SubagentStrip threadId={threadId} onOpen={openSubagent} /> : null}

            <Composer thread={thread} />
          </div>
        </div>

        {subagentPaneOpen && !externalSubagentPane ? (
          <SubagentPane
            threadId={threadId}
            theme={theme}
            onSelect={selectSubagent}
            onClose={closeSubagentPane}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The header's Activity control: a one-click jump to the running-work panel, with
 * a badge while tools or subagents are live. The label collapses below 40rem.
 */
function ActivityButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="activity-button"
      onClick={onOpen}
      title="Activity"
      aria-label={count > 0 ? `Activity, ${count} running` : 'Activity'}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-2xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
    >
      <Activity aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      <span className="hidden @min-[40rem]:inline">Activity</span>
      {count > 0 ? (
        <Badge variant="info" size="sm" className="ml-0.5">
          {count}
        </Badge>
      ) : null}
    </button>
  );
}
