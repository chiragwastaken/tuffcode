import type { BrainKind } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Select,
  Spinner,
  Textarea,
  cn,
  focusRing,
} from '@tuffcode/ui';
import { X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { BRAIN_KIND_LABEL, CREATABLE_BRAIN_KINDS } from '../inspector/brain-model';
import { formatSearchScore } from './brain-search';
import { BRAIN_KIND_COLOR } from './graph-style';

export interface BrainListRow {
  id: string;
  kind: BrainKind;
  text: string;
  /** Retrieval score from `memory.search`; absent for graph rows. */
  score?: number;
  /** Why the selector picked this entry; absent for graph rows. */
  reason?: string;
  importance?: number;
  degree?: number;
  /** False for inactive entries that no longer appear in the graph. */
  active?: boolean;
}

export interface BrainListProps {
  rows: readonly BrainListRow[];
  loading: boolean;
  error: string | null;
  searching: boolean;
  selectedId: string | null;
  emptyAction?: ReactNode;
  onSelect: (id: string) => void;
  onClearSearch: () => void;
}

export function BrainList({
  rows,
  loading,
  error,
  searching,
  selectedId,
  emptyAction,
  onSelect,
  onClearSearch,
}: BrainListProps) {
  if (error !== null) {
    return (
      <p role="alert" className="px-2 py-2 text-2xs leading-4 text-error">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    if (loading) {
      return (
        <div data-testid="brain-list-skeleton" className="flex flex-col gap-2 p-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex animate-pulse flex-col gap-1">
              <span className="h-2 w-10 rounded-full bg-muted" />
              <span className="h-2.5 w-full rounded-full bg-muted" />
              <span className="h-2.5 w-2/3 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="p-2">
        <EmptyState
          variant="inline"
          title={searching ? 'No matches.' : 'No entries yet.'}
          action={
            searching ? (
              <Button size="sm" variant="secondary" onClick={onClearSearch}>
                Clear
              </Button>
            ) : (
              emptyAction
            )
          }
          className="w-full flex-col items-start gap-1.5"
        />
      </div>
    );
  }

  return (
    <ul
      aria-label={searching ? 'Brain search results' : 'Brain entries'}
      className="divide-y divide-border"
    >
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            aria-pressed={row.id === selectedId}
            data-testid="brain-list-row"
            data-node-id={row.id}
            data-kind={row.kind}
            onClick={() => onSelect(row.id)}
            className={cn(
              'flex w-full min-w-0 flex-col gap-1 px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-accent',
              row.id === selectedId && 'bg-accent',
              focusRing,
            )}
          >
            <span className="flex min-w-0 items-center gap-1">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: BRAIN_KIND_COLOR[row.kind] }}
              />
              <span className="truncate text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                {BRAIN_KIND_LABEL[row.kind]}
              </span>
              {row.score === undefined ? (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {row.active === false ? (
                    <Badge variant="neutral" size="sm">
                      Off
                    </Badge>
                  ) : null}
                  {row.importance === undefined ? null : (
                    <span className="text-2xs tabular-nums text-muted-foreground">
                      {row.importance.toFixed(2)}
                      {row.degree !== undefined && row.degree > 0 ? ` · ${String(row.degree)}` : ''}
                    </span>
                  )}
                </span>
              ) : (
                <Badge variant="primary" size="sm" className="ml-auto">
                  {formatSearchScore(row.score)}
                </Badge>
              )}
            </span>
            <span
              className={cn(
                'line-clamp-2 text-xs leading-4 break-words',
                row.active === false ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {row.text}
            </span>
            {row.reason === undefined ? null : (
              <span
                className="line-clamp-2 text-2xs leading-4 break-words text-muted-foreground"
                title={row.reason}
              >
                {row.reason}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

const CREATABLE_OPTIONS = CREATABLE_BRAIN_KINDS.map((kind) => ({
  value: kind,
  label: BRAIN_KIND_LABEL[kind],
}));

export interface BrainAddFormProps {
  kind: BrainKind;
  text: string;
  adding: boolean;
  error: string | null;
  onKindChange: (kind: BrainKind) => void;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function BrainAddForm({
  kind,
  text,
  adding,
  error,
  onKindChange,
  onTextChange,
  onSubmit,
  onCancel,
}: BrainAddFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="New brain entry"
      className="flex flex-col gap-1.5 border-b border-border p-2"
    >
      <Textarea
        autoFocus
        rows={2}
        className="min-h-0 text-xs"
        aria-label="New brain entry text"
        placeholder="Add a rule or preference"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <Select
        aria-label="New entry kind"
        className="h-7 text-2xs"
        options={CREATABLE_OPTIONS}
        value={kind}
        onValueChange={(value) => {
          if (value === 'rule' || value === 'preference') onKindChange(value);
        }}
      />
      <div className="flex items-center gap-1">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={adding || text.trim().length === 0}
        >
          {adding ? <Spinner size="sm" label="Adding entry" /> : null}
          Add
        </Button>
        <IconButton icon={X} label="Cancel new entry" size="sm" onClick={onCancel} />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-2xs leading-4 text-error">
          {error}
        </p>
      )}
    </form>
  );
}
