import { LoaderCircle } from 'lucide-react';
import { cn } from './cn';

export interface SpinnerProps {
  className?: string;
  /** Accessible name for the live region. */
  label?: string;
  size?: 'sm' | 'md';
}

export function Spinner({ className, label = 'Loading', size = 'md' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <LoaderCircle
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(
          'animate-spin text-muted-foreground',
          size === 'sm' ? 'size-3.5' : 'size-4',
          className,
        )}
      />
    </span>
  );
}
