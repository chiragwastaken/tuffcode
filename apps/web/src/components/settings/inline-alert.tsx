import { cn } from '@tuffcode/ui';
import type { ReactNode } from 'react';

export type InlineAlertTone = 'error' | 'success' | 'info';

const TONE_CLASS: Record<InlineAlertTone, string> = {
  error: 'border-error/40 bg-error-surface text-error-foreground',
  success: 'border-success/40 bg-success/10 text-success-foreground',
  info: 'border-border bg-muted text-muted-foreground',
};

export interface InlineAlertProps {
  tone?: InlineAlertTone;
  children: ReactNode;
  className?: string;
}

export function InlineAlert({ tone = 'error', children, className }: InlineAlertProps) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-2.5 py-2 text-xs leading-5', TONE_CLASS[tone], className)}
    >
      {children}
    </p>
  );
}
