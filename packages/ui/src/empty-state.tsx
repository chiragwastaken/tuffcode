import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
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
