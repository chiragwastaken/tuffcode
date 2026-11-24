import { Badge, Spinner, cn } from '@tuffcode/ui';
import type { CouncilSummary } from './council-goal';

export interface CouncilStatusStripProps {
  summary: CouncilSummary | null;
  /** The goal text, so the strip says which goal it is reporting on. */
  goalText?: string;
  error: string | null;
  className?: string;
}

/**
 * One compact row above the goal box: the goal state, the work in flight, and the
 * work that came out of review. Fed by `council.status` and `council.updated`.
 */
export function CouncilStatusStrip({
  summary,
  goalText,
  error,
  className,
}: CouncilStatusStripProps) {
  if (error !== null) {
    return (
      <p
        role="alert"
        data-testid="council-status-strip"
        className={cn('px-1 pb-2 text-2xs leading-4 text-error', className)}
      >
        {error}
      </p>
    );
  }

  if (summary === null) return null;

  return (
    <div
      data-testid="council-status-strip"
      data-state={summary.state}
      className={cn(
        'mb-2 flex min-w-0 items-center gap-2 rounded-lg border border-border bg-message-surface/60 px-2.5 py-1.5 text-2xs text-muted-foreground',
        className,
      )}
    >
      <Badge variant={summary.tone} size="sm">
        {summary.label}
      </Badge>
      {goalText ? (
        <span className="min-w-0 flex-1 truncate text-foreground/80" title={goalText}>
          {goalText}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <span className="shrink-0 tabular-nums">{summary.running} running</span>
      <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
        ·
      </span>
      <span className="shrink-0 tabular-nums">{summary.passed} passed</span>
      {summary.terminal ? null : <Spinner size="sm" label="Council running" />}
    </div>
  );
}
