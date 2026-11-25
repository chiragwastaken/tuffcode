import type { ThreadEventRow } from '@tuffcode/contracts';
import { cn, EmptyState, ScrollArea } from '@tuffcode/ui';
import { Activity, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/app-store';
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
import { runningElapsedMs, runningToolRows } from './activity-model';

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
 * What the thread is doing right now: open tool calls with their output tail,
 * every subagent of the thread, and the work waiting on the user or a slot.
 * Rows expand in place; nothing here navigates away from the thread.
 */
export function ActivityPanel({ threadId }: ActivityPanelProps) {
  const events = useAppStore((state) => state.events[threadId]);
  const subagents = useAppStore(
    useShallow((state) => subagentsOfThread(state.subagents, threadId)),
  );
  const openSubagent = useAppStore((state) => state.openSubagent);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const tools = useMemo(
    () => runningToolRows(events ?? EMPTY_EVENTS, subagents),
    [events, subagents],
  );
  const queued = subagents.filter((child) => child.status === 'queued');
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

  const idle = tools.length === 0 && subagents.length === 0;

  return (
    <ScrollArea className="h-full min-h-0">
      <div data-testid="activity-panel" className="flex flex-col gap-2 p-2">
        {idle ? (
          <EmptyState
            variant="inline"
            icon={Activity}
            title="Nothing running. Tool calls and subagents appear here while a turn runs."
            className="px-1 py-2"
          />
        ) : null}

        {tools.length > 0 ? (
          <section aria-label="Running tools" className="flex flex-col gap-0.5">
            <SectionHeading label="Running" count={tools.length} />
            {tools.map((tool) => {
              const isOpen = expanded.has(tool.key);
              const tail = outputTail(tool.output);
              const elapsed = formatDuration(runningElapsedMs(tool.startedAt, now));
              return (
                <div key={tool.key}>
                  <button
                    type="button"
                    data-testid="activity-running-tool"
                    aria-expanded={isOpen}
                    onClick={() => toggle(tool.key)}
                    title={tool.headline}
                    className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-accent"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className={cn(
                        'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
                        isOpen && 'rotate-90',
                      )}
                    />
                    {tool.childType === null ? null : (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {SUBAGENT_TYPE_LABEL[tool.childType]}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{tool.headline}</span>
                    {elapsed === '' ? null : (
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {elapsed}
                      </span>
                    )}
                  </button>
                  {isOpen ? (
                    <div className="mt-0.5 mb-1 rounded-md border border-border bg-card px-2 py-1.5">
                      {tail.lines.length === 0 ? (
                        <p className="text-2xs text-muted-foreground">No output yet.</p>
                      ) : (
                        <>
                          {tail.hidden > 0 ? (
                            <p className="text-2xs text-muted-foreground">
                              {tail.hidden} earlier lines
                            </p>
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
            })}
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
          <SectionHeading label="Waiting" count={queued.length} />
          {queued.length === 0 ? (
            <p
              data-testid="activity-waiting-empty"
              className="px-1.5 text-2xs text-muted-foreground"
            >
              No pending approvals
            </p>
          ) : (
            queued.map((child) => (
              <button
                key={child.childId}
                type="button"
                data-testid="activity-waiting-row"
                onClick={() => openSubagent(child.childId)}
                className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">
                  {SUBAGENT_TYPE_LABEL[child.type]} {SUBAGENT_STATUS_LABEL[child.status]}
                </span>
              </button>
            ))
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
