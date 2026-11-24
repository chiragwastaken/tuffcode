import { cn } from './cn';
import {
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  STATUS_TEXT_CLASS,
  STATUS_TONE,
  type StatusKey,
} from './status';

export interface StatusDotProps {
  status: StatusKey;
  /** Render the human label next to the dot. */
  withLabel?: boolean;
  className?: string;
}

export function StatusDot({ status, withLabel = false, className }: StatusDotProps) {
  const tone = STATUS_TONE[status];
  const label = STATUS_LABEL[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-2xs',
        STATUS_TEXT_CLASS[tone],
        className,
      )}
    >
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[tone])}
      />
      {withLabel ? <span className="font-medium">{label}</span> : null}
    </span>
  );
}
