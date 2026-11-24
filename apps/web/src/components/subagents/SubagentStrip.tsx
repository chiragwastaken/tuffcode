import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/app-store';
import {
  SUBAGENT_TYPE_ICON,
  SUBAGENT_TYPE_LABEL,
  isRunningSubagent,
  subagentStripLabel,
  subagentTypeCounts,
  subagentsOfThread,
} from './subagent-model';

export interface SubagentStripProps {
  threadId: string;
  onOpen(childId: string): void;
}

/**
 * What replaces the cards while the pane is closed: one compact row with the
 * running count and the types involved. Clicking opens the pane on live work.
 */
export function SubagentStrip({ threadId, onOpen }: SubagentStripProps) {
  const subagents = useAppStore(
    useShallow((state) => subagentsOfThread(state.subagents, threadId)),
  );

  if (subagents.length === 0) return null;

  const target = subagents.find(isRunningSubagent) ?? subagents[0];
  if (target === undefined) return null;
  const types = subagentTypeCounts(subagents);

  return (
    <div className="flex shrink-0 justify-center px-4 pt-1 pb-0.5">
      <button
        type="button"
        data-testid="subagent-strip"
        data-running={subagents.some(isRunningSubagent) ? 'true' : 'false'}
        onClick={() => onOpen(target.childId)}
        className="flex h-8 max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 text-2xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          {types.map(({ type, count }) => {
            const Icon = SUBAGENT_TYPE_ICON[type];
            return (
              <span
                key={type}
                data-testid={`subagent-strip-type-${type}`}
                title={`${SUBAGENT_TYPE_LABEL[type]}${count > 1 ? ` ×${count}` : ''}`}
                className="flex items-center gap-0.5"
              >
                <Icon strokeWidth={1.75} className="size-3" />
                {count > 1 ? <span className="tabular-nums">{count}</span> : null}
              </span>
            );
          })}
        </span>
        <span data-testid="subagent-strip-label" className="truncate font-medium text-foreground">
          {subagentStripLabel(subagents)}
        </span>
        <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
      </button>
    </div>
  );
}
