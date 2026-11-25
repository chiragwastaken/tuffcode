import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
  /**
   * `card` is the boxed empty state for a whole screen; `inline` shows a muted line
   * for panels with their own frame, with the description wrapped under the title
   * instead of being truncated away.
   */
  variant?: 'card' | 'inline';
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
  variant = 'card',
}: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex min-w-0 gap-2 text-xs text-muted-foreground',
          // A description makes the block two lines tall; the icon belongs to the
          // title, so it stays at the top instead of floating between the lines.
          description ? 'items-start' : 'items-center',
          className,
        )}
      >
        {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="min-w-0 truncate">{title}</p>
          {description ? <p className="min-w-0 leading-5">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center',
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-5 text-muted-foreground" />
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-72 text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
