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
 * Measured geometry of the resting bar: an 8px top pad, one 20px `text-xs` line, an
 * 8px bottom pad and the 1px top border. `bottom-6` adds the 24px gutter the settings
 * column already reserves, so the scroll content must end with that full clearance
 * for the last row to scroll clear of the bar.
 */
export const SAVE_BAR_HEIGHT_PX = 37;
export const SAVE_BAR_OFFSET_PX = 24;
export const SAVE_BAR_CLEARANCE_PX = SAVE_BAR_HEIGHT_PX + SAVE_BAR_OFFSET_PX;

/**
 * Footer for a settings form. `mt-auto` pushes it to the bottom of the full-height
 * settings column, so at rest it sits at the window bottom instead of mid-page.
 * `sticky bottom-6` keeps it there while a long section scrolls; the 24px offset is
 * the settings column's own `p-6` gutter, so the bar does not jump when the scroll
 * reaches the end. While the draft is clean it collapses to a single saved line so
 * the page still shows its state; with unsaved changes it grows the reset and save
 * actions, and save stays disabled when the draft is invalid.
 */
export function SaveBar({ dirty, saving, invalid, error, onReset, className }: SaveBarProps) {
  if (!dirty && !saving) {
    return (
      <div
        data-testid="save-bar"
        data-state="saved"
        className={cn(
          'sticky bottom-6 z-10 mt-auto flex items-center gap-1.5 border-t border-border bg-background/95 px-3 py-2 text-xs leading-5 text-muted-foreground backdrop-blur',
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
        'sticky bottom-6 z-10 mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-3 py-2 backdrop-blur',
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
