import { cn } from '@tuffcode/ui';
import type { ReactNode } from 'react';

export interface SettingsRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  description,
  htmlFor,
  error,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start sm:gap-6',
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium text-foreground">{label}</span>
        )}
        {description ? (
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {error ? (
          <p
            id={htmlFor ? `${htmlFor}-error` : undefined}
            role="alert"
            className="text-xs leading-5 text-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
