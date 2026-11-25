import { useVirtualizer } from '@tanstack/react-virtual';
import { Input, cn } from '@tuffcode/ui';
import { Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ModelLimitErrors } from './provider-form';
import type { PresetModel } from './provider-presets';

const ROW_HEIGHT = 34;

function compact(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return '-';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

export function filterModelRows(models: readonly PresetModel[], query: string): PresetModel[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...models];
  return models.filter((model) => model.id.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle));
}

export interface ModelLimitsListProps {
  models: readonly PresetModel[];
  errors: Readonly<Record<string, ModelLimitErrors>>;
  onChange: (modelId: string, key: 'contextWindow' | 'maxOutputTokens', value: number | null) => void;
}

/**
 * Discovered models as a searchable, virtualized list with their limits and abilities
 * at a glance. One row at a time opens an editor, so a catalog of hundreds never
 * renders hundreds of inputs.
 */
export function ModelLimitsList({ models, errors, onChange }: ModelLimitsListProps) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useMemo(() => filterModelRows(models, query), [models, query]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const selected = editing === null ? undefined : models.find((model) => model.id === editing);
  const selectedErrors = editing === null ? undefined : errors[editing];

  return (
    <div className="flex flex-col gap-1.5" data-testid="model-limits">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          Models <span className="font-normal text-muted-foreground tabular-nums">{models.length}</span>
        </span>
        <span className="text-2xs text-muted-foreground">Click a model to override its limits.</span>
      </div>
      {models.length > 8 ? (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models"
            aria-label="Search models"
            data-testid="model-limits-search"
            className="h-7 pl-7 text-xs"
          />
        </div>
      ) : null}
      <div ref={scrollRef} className="max-h-64 overflow-y-auto rounded-md border border-border">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const model = rows[item.index];
            if (model === undefined) return null;
            const caps = model.capabilities;
            const invalid = errors[model.id] !== undefined;
            return (
              <button
                key={model.id}
                type="button"
                data-testid="model-limits-row"
                onClick={() => setEditing((current) => (current === model.id ? null : model.id))}
                className={cn(
                  'absolute left-0 flex w-full items-center gap-2 border-b border-border/60 px-2.5 text-left text-xs hover:bg-accent',
                  editing === model.id ? 'bg-accent' : '',
                  invalid ? 'text-error-foreground' : '',
                )}
                style={{ top: item.start, height: ROW_HEIGHT }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-2xs" title={model.id}>
                  {model.id}
                </span>
                {caps?.tools ? <Chip>tools</Chip> : null}
                {caps?.vision ? <Chip>vision</Chip> : null}
                {caps?.reasoning ? <Chip>reasoning</Chip> : null}
                <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                  {compact(model.contextWindow)} / {compact(model.maxOutputTokens)}
                </span>
              </button>
            );
          })}
        </div>
        {rows.length === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground">No models match.</p> : null}
      </div>
      {selected === undefined ? null : (
        <div className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2" data-testid="model-limits-editor">
          <span className="col-span-full truncate font-mono text-2xs text-foreground">{selected.id}</span>
          <LimitInput
            label="Context window"
            value={selected.contextWindow}
            error={selectedErrors?.contextWindow}
            step={1000}
            onChange={(value) => onChange(selected.id, 'contextWindow', value)}
          />
          <LimitInput
            label="Max output"
            value={selected.maxOutputTokens}
            error={selectedErrors?.maxOutputTokens}
            step={256}
            onChange={(value) => onChange(selected.id, 'maxOutputTokens', value)}
          />
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return <span className="shrink-0 rounded-sm bg-muted px-1 text-2xs text-muted-foreground">{children}</span>;
}

function LimitInput({
  label,
  value,
  error,
  step,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  error: string | undefined;
  step: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={1}
        step={step}
        className="h-7 text-xs tabular-nums"
        value={value ?? ''}
        placeholder="From discovery"
        aria-invalid={error !== undefined}
        onChange={(event) => onChange(event.target.value.trim() === '' ? null : Number(event.target.value))}
      />
      {error ? (
        <span role="alert" className="text-2xs text-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
