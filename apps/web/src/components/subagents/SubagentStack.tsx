import type { ThreadEventRow } from '@tuffcode/contracts';
import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/app-store';
import { SubagentCard } from './SubagentCard';
import { placeSubagents, subagentsOfThread } from './subagent-model';
import { useSubagentClock } from './use-subagents';

/** The small caption above a group of cards: which turn, and how many children. */
function GroupHeader({ label, count }: { label: string; count: number }): ReactNode {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <span className="font-medium">{label}</span>
      <span aria-hidden="true">·</span>
      <span>{count === 1 ? '1 subagent' : `${count} subagents`}</span>
    </div>
  );
}

export interface SubagentStackProps {
  threadId: string;
  /** Parent timeline rows, used to attribute each child to its spawn turn. */
  events: readonly ThreadEventRow[];
  activeChildId: string | null;
  onOpen(childId: string): void;
}

/**
 * The subagent cards for one parent thread, grouped under the turn that spawned
 * them. Children whose spawn row is not in the loaded log still render, under a
 * session group, so a delegated child is never invisible.
 */
export function SubagentStack({ threadId, events, activeChildId, onOpen }: SubagentStackProps) {
  const subagents = useAppStore(
    useShallow((state) => subagentsOfThread(state.subagents, threadId)),
  );
  const now = useSubagentClock(subagents);
  const placement = useMemo(() => placeSubagents(subagents, events), [events, subagents]);

  if (subagents.length === 0) return null;

  return (
    <section
      data-testid="subagent-stack"
      aria-label="Subagents spawned in this thread"
      className="@container shrink-0 border-t border-border px-4 pt-2 pb-1"
    >
      <div className="mx-auto flex w-full max-w-[var(--chat-content-max-width)] flex-col gap-2">
        {placement.groups.map((group) => (
          <div key={group.turnId} data-testid="subagent-group" data-turn-id={group.turnId}>
            <GroupHeader label={group.label} count={group.children.length} />
            <div className="grid gap-1.5 @min-[30rem]:grid-cols-2">
              {group.children.map((child) => (
                <SubagentCard
                  key={child.childId}
                  child={child}
                  now={now}
                  active={child.childId === activeChildId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        ))}

        {placement.unplaced.length > 0 ? (
          <div data-testid="subagent-group" data-turn-id="">
            <GroupHeader label="This session" count={placement.unplaced.length} />
            <div className="grid gap-1.5 @min-[30rem]:grid-cols-2">
              {placement.unplaced.map((child) => (
                <SubagentCard
                  key={child.childId}
                  child={child}
                  now={now}
                  active={child.childId === activeChildId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
