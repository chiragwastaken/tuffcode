import { Input, cn } from '@tuffcode/ui';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

/** The built-in ladder; `none` is shown as "off". */
export const STANDARD_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

const LEVEL = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function effortLabel(level: string): string {
  return level === 'none' ? 'off' : level;
}

/** Comma text (the form's stored shape) to a clean, de-duplicated list. */
export function parseEfforts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const level = raw.trim().toLowerCase();
    if (LEVEL.test(level) && !out.includes(level)) out.push(level);
  }
  return out;
}

export function toggleEffort(levels: readonly string[], level: string): string[] {
  return levels.includes(level) ? levels.filter((entry) => entry !== level) : [...levels, level];
}

export interface ReasoningPillsProps {
  value: readonly string[];
  onChange: (levels: string[]) => void;
  testId?: string;
}

/**
 * Selectable reasoning levels: the standard ladder as toggle pills plus `+` for a
 * provider's own level (for example `max`). Replaces the comma-separated text box.
 */
export function ReasoningPills({ value, onChange, testId }: ReasoningPillsProps) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');
  const customLevels = value.filter((level) => !(STANDARD_EFFORTS as readonly string[]).includes(level));
  const valid = LEVEL.test(custom.trim().toLowerCase());

  function addCustom(event: FormEvent): void {
    event.preventDefault();
    const level = custom.trim().toLowerCase();
    if (!LEVEL.test(level)) return;
    if (!value.includes(level)) onChange([...value, level]);
    setCustom('');
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testId} role="group" aria-label="Reasoning levels">
      {[...STANDARD_EFFORTS, ...customLevels].map((level) => {
        const on = value.includes(level);
        const builtIn = (STANDARD_EFFORTS as readonly string[]).includes(level);
        return (
          <span key={level} className="flex">
            <button
              type="button"
              aria-pressed={on}
              data-testid={`effort-pill-${level}`}
              onClick={() => onChange(toggleEffort(value, level))}
              className={cn(
                'h-7 rounded-full border px-3 text-xs transition-colors',
                on ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                builtIn ? '' : 'rounded-r-none pr-2',
              )}
            >
              {effortLabel(level)}
            </button>
            {builtIn ? null : (
              <button
                type="button"
                aria-label={`Remove ${level}`}
                onClick={() => onChange(value.filter((entry) => entry !== level))}
                className="flex h-7 items-center rounded-r-full border border-l-0 border-border px-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            )}
          </span>
        );
      })}
      {adding ? (
        <form onSubmit={addCustom} className="flex items-center gap-1">
          <Input
            autoFocus
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={() => (custom.trim().length === 0 ? setAdding(false) : undefined)}
            placeholder="max"
            aria-label="Custom reasoning level"
            aria-invalid={custom.length > 0 && !valid}
            className="h-7 w-24 text-xs"
          />
        </form>
      ) : (
        <button
          type="button"
          aria-label="Add a custom reasoning level"
          data-testid="effort-pill-add"
          onClick={() => setAdding(true)}
          className="flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
