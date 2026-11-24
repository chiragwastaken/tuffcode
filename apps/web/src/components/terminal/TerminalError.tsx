import { Button, cn } from '@tuffcode/ui';
import { AlertTriangle } from 'lucide-react';

export interface TerminalErrorProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

/** Inline failure notice with the retry action the server error expects. */
export function TerminalError({ message, onRetry, className }: TerminalErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 rounded-md border border-error/40 bg-error-surface px-2.5 py-2',
        'text-xs leading-5 text-error-foreground',
        className,
      )}
    >
      <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function terminalErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return 'The terminal request failed.';
}
