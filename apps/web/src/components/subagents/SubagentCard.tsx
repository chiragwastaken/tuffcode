import { Badge, StatusDot, cn } from '@tuffcode/ui';
import { ArrowUpRight } from 'lucide-react';
import type { SubagentChild } from '../../store/app-store';
import { formatDuration } from '../thread/turn-blocks';
import {
  SUBAGENT_STATUS_LABEL,
  SUBAGENT_STATUS_TONE,
  SUBAGENT_TYPE_ICON,
  SUBAGENT_TYPE_LABEL,
  subagentElapsedMs,
} from './subagent-model';

export interface SubagentCardProps {
  child: SubagentChild;
  /** Clock for the elapsed label; a running child counts up to this instant. */
  now: number;
  /** The child shown in the pane, marked so the connector can find its card. */
  active: boolean;
  onOpen(childId: string): void;
}

/**
 * The parent-timeline card for one child: type badge, model, status and elapsed,
 * and the whole card opens the child pane.
 */
export function SubagentCard({ child, now, active, onOpen }: SubagentCardProps) {
  const Icon = SUBAGENT_TYPE_ICON[child.type];
  const elapsed = formatDuration(subagentElapsedMs(child, now));

  return (
    <button
      type="button"
      data-testid="subagent-card"
      data-child-id={child.childId}
      data-subagent-type={child.type}
      data-active={active ? 'true' : undefined}
      aria-label={`Open ${SUBAGENT_TYPE_LABEL[child.type]} subagent ${child.childId}`}
      onClick={() => onOpen(child.childId)}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-left',
        'transition-colors duration-150 ease-out hover:bg-accent',
        active && 'border-primary/40 bg-primary/5 hover:bg-primary/5',
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground',
          active && 'text-primary',
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge variant="outline" size="sm">
            {SUBAGENT_TYPE_LABEL[child.type]}
          </Badge>
          {child.model.length > 0 ? (
            <span
              data-testid="subagent-card-model"
              title={child.model}
              className="truncate font-mono text-2xs text-muted-foreground"
            >
              {child.model}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <StatusDot status={SUBAGENT_STATUS_TONE[child.status]} />
          <span
            data-testid="subagent-card-status"
            data-status={child.status}
            className="text-2xs text-muted-foreground"
          >
            {SUBAGENT_STATUS_LABEL[child.status]}
          </span>
          {elapsed.length > 0 ? (
            <span className="text-2xs tabular-nums text-muted-foreground/70">{elapsed}</span>
          ) : null}
        </span>
      </span>

      <ArrowUpRight
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground"
      />
    </button>
  );
}
