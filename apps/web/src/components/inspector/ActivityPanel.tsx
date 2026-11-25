import type { SubagentType, ThreadEventRow } from '@tuffcode/contracts';
import { Badge, cn, EmptyState, ScrollArea } from '@tuffcode/ui';
import { Activity, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/app-store';
import { useCouncilStatus } from '../council/use-council-status';
import {
  SUBAGENT_STATUS_LABEL,
  SUBAGENT_STATUS_TONE,
  SUBAGENT_TYPE_ICON,
  SUBAGENT_TYPE_LABEL,
  isRunningSubagent,
  subagentElapsedMs,
  subagentsOfThread,
} from '../subagents/subagent-model';
import { StatusChip } from '../thread/status-chip';
import { formatDuration, outputTail } from '../thread/turn-blocks';
import {
  councilActivityOf,
  finishedToolRows,
  runningElapsedMs,
  runningToolRows,
  waitingItems,
  type CouncilActivity,
} from './activity-model';

export interface ActivityPanelProps {
  threadId: string;
}

const EMPTY_EVENTS: readonly ThreadEventRow[] = [];

/** A one-second clock that runs only while something is live. */
function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * The Activity tab: what the thread is doing right now. A council thread adds a
 * Council section read from its goal; a work thread shows only tools, subagents
 * and the work waiting on the user or a slot.
 */
export function ActivityPanel({ threadId }: ActivityPanelProps) {
  const executionMode = useAppStore((state) => state.threads[threadId]?.executionMode);
  if (executionMode === 'council') return <CouncilActivityPanel threadId={threadId} />;
  return <ActivityBody threadId={threadId} council={null} councilResolving={false} />;
}

/** Council threads own a goal, so the status hook lives in this branch only. */
function CouncilActivityPanel({ threadId }: ActivityPanelProps) {
  const { status, loading } = useCouncilStatus(threadId);
  return (
    <ActivityBody
      threadId={threadId}
      council={councilActivityOf(status)}
      councilResolving={status === null && loading}
    />
  );
}

interface ActivityBodyProps {
  threadId: string;
  /** The council goal of a council thread; null for work threads and no goal. */
  council: CouncilActivity | null;
  /** True while a council thread's goal is still being looked up. */
  councilResolving: boolean;
}

/**
 * Open tool calls with their output tail, the calls that already finished this
 * session, every subagent of the thread, the council goal when there is one, and
 * the work waiting on the user or a slot. Rows expand in place; nothing here
 * navigates away from the thread.
 */
function ActivityBody({ threadId, council, councilResolving }: ActivityBodyProps) {
  const events = useAppStore((state) => state.events[threadId]);
  const subagents = useAppStore(
    useShallow((state) => subagentsOfThread(state.subagents, threadId)),
  );
  const openSubagent = useAppStore((state) => state.openSubagent);
  const threadStatus = useAppStore((state) => state.threads[threadId]?.status);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const tools = useMemo(
    () => runningToolRows(events ?? EMPTY_EVENTS, subagents),
    [events, subagents],
  );
  const finished = useMemo(
    () => finishedToolRows(events ?? EMPTY_EVENTS, subagents),
    [events, subagents],
  );
  const waiting = waitingItems(subagents, threadStatus);
  const live = tools.length > 0 || subagents.some(isRunningSubagent);
  const now = useLiveClock(live);

  const toggle = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const idle =
    tools.length === 0 &&
    finished.length === 0 &&
    subagents.length === 0 &&
    waiting.length === 0 &&
    !councilResolving &&
    !(council?.goalActive ?? false);

  return (
    <ScrollArea className="h-full min-h-0">
      <div data-testid="activity-panel" className="flex flex-col gap-2 p-2">
        {idle ? (
          <EmptyState
            variant="inline"
            icon={Activity}
            title="Nothing running"
            description="Tool calls and subagents appear here while a turn runs."
            className="px-1 py-2"
          />
        ) : null}

        {council === null ? null : (
          <section
            aria-label="Council"
            data-testid="activity-council"
            className="flex flex-col gap-0.5"
          >
            <SectionHeading label="Council" count={council.tasks.length} />
            <div
              data-testid="activity-council-goal"
              data-state={council.goalState}
              className="flex h-8 min-w-0 items-center gap-1.5 px-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">Goal</span>
              <Badge variant={council.goalTone} size="sm">
                {council.goalLabel}
              </Badge>
            </div>
            {council.tasks.map((task) => (
              <div
                key={task.id}
                data-testid="activity-council-task"
                data-state={task.state}
                className="flex h-8 min-w-0 items-center gap-1.5 px-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-foreground" title={task.title}>
                  {task.title}
                </span>
                <Badge variant={task.tone} size="sm">
                  {task.stateLabel}
                </Badge>
              </div>
            ))}
          </section>
        )}

        {tools.length > 0 ? (
          <section aria-label="Running tools" className="flex flex-col gap-0.5">
            <SectionHeading label="Running" count={tools.length} />
            {tools.map((tool) => {
              const elapsed = formatDuration(runningElapsedMs(tool.startedAt, now));
              return (
                <ToolRow
                  key={tool.key}
                  testId="activity-running-tool"
                  headline={tool.headline}
                  childType={tool.childType}
                  output={tool.output}
                  expanded={expanded.has(tool.key)}
                  onToggle={() => toggle(tool.key)}
                  emptyLabel="No output yet."
                  trailing={
                    elapsed === '' ? null : (
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {elapsed}
                      </span>
                    )
                  }
                />
              );
            })}
          </section>
        ) : null}

        {finished.length > 0 ? (
          <section aria-label="Finished tools" className="flex flex-col gap-0.5">
            <SectionHeading label="Finished" count={finished.length} />
            {finished.map((tool) => (
              <ToolRow
                key={tool.key}
                testId="activity-finished-tool"
                headline={tool.headline}
                childType={tool.childType}
                output={tool.output}
                expanded={expanded.has(tool.key)}
                onToggle={() => toggle(tool.key)}
                emptyLabel="No output."
                error={tool.isError}
                trailing={
                  tool.isError ? (
                    <span className="shrink-0 text-2xs text-error-foreground">Error</span>
                  ) : null
                }
              />
            ))}
          </section>
        ) : null}

        {subagents.length > 0 ? (
          <section aria-label="Subagents" className="flex flex-col gap-0.5">
            <SectionHeading label="Subagents" count={subagents.length} />
            {subagents.map((child) => {
              const Icon = SUBAGENT_TYPE_ICON[child.type];
              const elapsed = formatDuration(subagentElapsedMs(child, now));
              return (
                <button
                  key={child.childId}
                  type="button"
                  data-testid="activity-subagent-row"
                  data-status={child.status}
                  onClick={() => openSubagent(child.childId)}
                  title={child.task.length === 0 ? SUBAGENT_TYPE_LABEL[child.type] : child.task}
                  className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-accent"
                >
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                  <span className="shrink-0">{SUBAGENT_TYPE_LABEL[child.type]}</span>
                  <StatusChip status={SUBAGENT_STATUS_TONE[child.status]} className="h-3.5 px-1" />
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                    {child.model}
                  </span>
                  {elapsed === '' ? null : (
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {elapsed}
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        ) : null}

        <section aria-label="Waiting" className="flex flex-col gap-0.5">
          <SectionHeading label="Waiting" count={waiting.length} />
          {waiting.length === 0 ? (
            <p
              data-testid="activity-waiting-empty"
              className="px-1.5 text-2xs text-muted-foreground"
            >
              Nothing is waiting
            </p>
          ) : (
            waiting.map((item) =>
              item.kind === 'approval' ? (
                <p
                  key="approval"
                  data-testid="activity-waiting-approval"
                  className="flex h-8 items-center px-1.5 text-xs text-muted-foreground"
                >
                  An approval is waiting in the timeline
                </p>
              ) : (
                <button
                  key={item.child.childId}
                  type="button"
                  data-testid="activity-waiting-row"
                  onClick={() => openSubagent(item.child.childId)}
                  className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {SUBAGENT_TYPE_LABEL[item.child.type]}{' '}
                    {SUBAGENT_STATUS_LABEL[item.child.status]}
                  </span>
                </button>
              ),
            )
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-baseline gap-1.5 px-1.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
      {label}
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </h3>
  );
}

interface ToolRowProps {
  testId: string;
  headline: string;
  childType: SubagentType | null;
  output: string;
  expanded: boolean;
  onToggle: () => void;
  emptyLabel: string;
  trailing?: ReactNode;
  error?: boolean;
}

/**
 * One tool row shared by Running and Finished: the headline, an optional
 * subagent prefix and trailing slot, and the output tail opened in place.
 */
function ToolRow({
  testId,
  headline,
  childType,
  output,
  expanded,
  onToggle,
  emptyLabel,
  trailing,
  error = false,
}: ToolRowProps) {
  const tail = outputTail(output);
  return (
    <div>
      <button
        type="button"
        data-testid={testId}
        data-error={error ? 'true' : undefined}
        aria-expanded={expanded}
        onClick={onToggle}
        title={headline}
        className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-accent"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {childType === null ? null : (
          <span className="shrink-0 text-2xs text-muted-foreground">
            {SUBAGENT_TYPE_LABEL[childType]}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{headline}</span>
        {trailing}
      </button>
      {expanded ? (
        <div className="mt-0.5 mb-1 rounded-md border border-border bg-card px-2 py-1.5">
          {tail.lines.length === 0 ? (
            <p className="text-2xs text-muted-foreground">{emptyLabel}</p>
          ) : (
            <>
              {tail.hidden > 0 ? (
                <p className="text-2xs text-muted-foreground">{tail.hidden} earlier lines</p>
              ) : null}
              <pre className="max-h-48 overflow-auto font-mono text-2xs leading-4 break-words whitespace-pre-wrap text-muted-foreground">
                {tail.lines.join('\n')}
              </pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
