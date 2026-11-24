import { cn } from '@tuffcode/ui';
import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
  disabled?: boolean;
  /** `md` is the 28px topbar switch; `sm` is the compact composer control. */
  size?: 'sm' | 'md';
  testId?: string;
  className?: string;
}

/**
 * A single-choice segmented control: `radiogroup` semantics, arrow keys move the
 * selection, and only the checked segment is in the tab order.
 */
export function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled = false,
  size = 'sm',
  testId,
  className,
}: SegmentedControlProps<T>) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || options.length === 0) return;
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const from = current === -1 ? 0 : current;
    const next = options[(from + (forward ? 1 : -1) + options.length) % options.length];
    if (next) onValueChange(next.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5',
        size === 'md' ? 'h-7' : 'h-6',
        disabled && 'opacity-64',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!selected) onValueChange(option.value);
            }}
            className={cn(
              'inline-flex h-full min-w-0 items-center rounded-sm border whitespace-nowrap transition-colors duration-150',
              size === 'md' ? 'gap-2 px-2.5 text-xs' : 'gap-1 px-2 text-2xs',
              selected
                ? 'border-border bg-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            {Icon ? (
              <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
