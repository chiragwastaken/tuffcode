import { Button, Spinner, cn } from '@tuffcode/ui';

export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  invalid?: boolean;
  error?: string | null;
  onReset: () => void;
  className?: string;
}

/**
 * Sticky footer for a settings form. It only exists while there are unsaved
 * changes, and its save button stays disabled when the draft is invalid.
 */
export function SaveBar({ dirty, saving, invalid, error, onReset, className }: SaveBarProps) {
  if (!dirty && !saving) return null;

  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-3 py-2 backdrop-blur',
        className,
      )}
    >
      <span
        role={error ? 'alert' : undefined}
        className={cn('text-xs leading-5', error ? 'text-error' : 'text-muted-foreground')}
      >
        {error ?? 'Unsaved changes.'}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={saving}>
          Reset
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={saving || invalid}>
          {saving ? <Spinner size="sm" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}
