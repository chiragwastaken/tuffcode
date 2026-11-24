import { Button, Spinner, cn } from '@tuffcode/ui';
import { Check } from 'lucide-react';

export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  invalid?: boolean;
  error?: string | null;
  onReset: () => void;
  className?: string;
}

/**
 * Sticky footer for a settings form. While the draft is clean it collapses to a
 * single saved line so the page still shows its state; with unsaved changes it
 * grows the reset and save actions, and save stays disabled when the draft is invalid.
 */
export function SaveBar({ dirty, saving, invalid, error, onReset, className }: SaveBarProps) {
  if (!dirty && !saving) {
    return (
      <div
        data-testid="save-bar"
        data-state="saved"
        className={cn(
          'sticky bottom-0 z-10 flex items-center gap-1.5 border-t border-border bg-background/95 px-3 py-2 text-xs leading-5 text-muted-foreground backdrop-blur',
          className,
        )}
      >
        <Check aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0 text-success" />
        <span>All changes saved</span>
      </div>
    );
  }

  return (
    <div
      data-testid="save-bar"
      data-state="dirty"
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
