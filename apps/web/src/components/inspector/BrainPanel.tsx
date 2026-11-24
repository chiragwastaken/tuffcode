import type { BrainEntry, BrainKind, BrainSlice } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  ScrollArea,
  Select,
  Spinner,
  Textarea,
  cn,
  focusRing,
} from '@tuffcode/ui';
import { ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import {
  BRAIN_KIND_LABEL,
  CREATABLE_BRAIN_KINDS,
  brainEntryMeta,
  isBrainSliceEmpty,
  sortBrainEntries,
  summarizeBrainSlice,
  toggleBrainEntryParams,
} from './brain-model';

export interface BrainPanelProps {
  threadId: string;
  projectId: string | null;
}

const SEARCH_DEBOUNCE_MS = 150;
const PREVIEW_DEBOUNCE_MS = 250;

const CREATABLE_OPTIONS = CREATABLE_BRAIN_KINDS.map((kind) => ({
  value: kind,
  label: BRAIN_KIND_LABEL[kind],
}));

function brainErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return 'The brain request failed.';
}

/**
 * Brain inspector: search and manage the entries the turn runner injects, plus a
 * live preview of the exact slice the next send would carry.
 */
export function BrainPanel({ threadId, projectId }: BrainPanelProps) {
  const rpc = useRpc();

  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<BrainEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [addKind, setAddKind] = useState<BrainKind>('rule');
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [previewMessage, setPreviewMessage] = useState('');
  const [slice, setSlice] = useState<BrainSlice | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState(0);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const addTextRef = useRef<HTMLTextAreaElement | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const search = query.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void rpc
        .request('brain.list', {
          ...(search.length === 0 ? {} : { query: search }),
          includeInactive: true,
          limit: 100,
        })
        .then((rows) => {
          if (cancelled) return;
          setEntries(rows);
          setListError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setListError(brainErrorMessage(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, query, reloadToken]);

  useEffect(() => {
    if (projectId === null) {
      setSlice(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      void rpc
        .request('brain.preview', {
          projectId,
          threadId,
          message: previewMessage,
        })
        .then((next) => {
          if (cancelled) return;
          setSlice(next);
          setPreviewError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setSlice(null);
          setPreviewError(brainErrorMessage(cause));
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, projectId, threadId, previewMessage, previewToken]);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
    setPreviewToken((token) => token + 1);
  }, []);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = addText.trim();
    if (text.length === 0 || adding) return;

    setAdding(true);
    setAddError(null);
    try {
      await rpc.request('brain.upsert', {
        kind: addKind,
        scope: 'global',
        text,
      });
      if (!mountedRef.current) return;
      setAddText('');
      // Reload rather than inserting locally: an active search must not gain a
      // row it does not match.
      refresh();
    } catch (cause) {
      if (mountedRef.current) setAddError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setAdding(false);
    }
  }

  async function toggleEntry(entry: BrainEntry): Promise<void> {
    if (busyId !== null) return;
    setBusyId(entry.id);
    setActionError(null);
    try {
      const updated = await rpc.request('brain.upsert', toggleBrainEntryParams(entry));
      if (!mountedRef.current) return;
      setEntries((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setPreviewToken((token) => token + 1);
    } catch (cause) {
      if (mountedRef.current) setActionError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  async function deleteEntry(entry: BrainEntry): Promise<void> {
    if (busyId !== null) return;
    setBusyId(entry.id);
    setActionError(null);
    try {
      await rpc.request('brain.delete', { id: entry.id });
      if (!mountedRef.current) return;
      setEntries((current) => current.filter((row) => row.id !== entry.id));
      setPendingDeleteId(null);
      setPreviewToken((token) => token + 1);
    } catch (cause) {
      if (mountedRef.current) setActionError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  const sorted = sortBrainEntries(entries);
  const searching = query.trim().length > 0;

  return (
    <section
      aria-label="Brain"
      data-testid="brain-panel"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        <Input
          type="search"
          className="h-8 text-xs"
          placeholder="Search brain"
          aria-label="Search brain entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton
          icon={RefreshCw}
          label="Refresh brain entries"
          size="sm"
          disabled={loading}
          onClick={refresh}
        />
      </div>

      {listError ? (
        <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-xs text-error">
          {listError}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-xs text-error">
          {actionError}
        </p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          <form
            onSubmit={(event) => void handleAdd(event)}
            className="flex flex-col gap-1.5 border-b border-border px-3 py-2"
          >
            <Textarea
              ref={addTextRef}
              rows={2}
              className="min-h-0 text-xs"
              aria-label="New brain entry"
              placeholder="Add a rule or preference for every thread"
              value={addText}
              onChange={(event) => setAddText(event.target.value)}
            />
            <div className="flex items-center gap-1.5">
              <div className="w-28 shrink-0">
                <Select
                  aria-label="New entry kind"
                  className="h-8 text-xs"
                  options={CREATABLE_OPTIONS}
                  value={addKind}
                  onValueChange={(value) => {
                    if (value === 'rule' || value === 'preference') setAddKind(value);
                  }}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={adding || addText.trim().length === 0}
              >
                {adding ? <Spinner size="sm" label="Adding entry" /> : null}
                Add
              </Button>
            </div>
            {addError ? (
              <p role="alert" className="text-2xs text-error">
                {addError}
              </p>
            ) : null}
          </form>

          <section aria-label="Injection preview" className="border-b border-border">
            <button
              type="button"
              aria-expanded={previewOpen}
              onClick={() => setPreviewOpen((open) => !open)}
              className={cn(
                'flex h-9 w-full items-center gap-2 px-3 text-left',
                'transition-colors duration-150 ease-out hover:bg-accent',
                focusRing,
              )}
            >
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                  previewOpen && 'rotate-90',
                )}
              />
              <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                Injection preview
              </span>
              {previewLoading ? <Spinner size="sm" label="Loading preview" /> : null}
              {slice ? (
                <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                  {summarizeBrainSlice(slice)}
                </span>
              ) : null}
            </button>
            {previewOpen ? (
              <div className="flex flex-col gap-2 px-3 pb-2">
                <Input
                  className="h-8 text-xs"
                  aria-label="Preview message"
                  placeholder="Preview with a draft message"
                  value={previewMessage}
                  onChange={(event) => setPreviewMessage(event.target.value)}
                />
                {projectId === null ? (
                  <p className="text-2xs leading-5 text-muted-foreground">
                    Open a thread to preview the injection for its project.
                  </p>
                ) : previewError ? (
                  <p role="alert" className="text-2xs text-error">
                    {previewError}
                  </p>
                ) : slice === null ? (
                  <p className="text-2xs leading-5 text-muted-foreground">
                    {previewLoading ? 'Loading preview…' : 'No preview available.'}
                  </p>
                ) : isBrainSliceEmpty(slice) ? (
                  <p className="text-2xs leading-5 text-muted-foreground">
                    Nothing is injected for this message.
                  </p>
                ) : (
                  <PreviewGroups slice={slice} />
                )}
              </div>
            ) : null}
          </section>

          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
              Entries
            </span>
            <span className="text-2xs tabular-nums text-muted-foreground">{entries.length}</span>
            {loading ? <Spinner size="sm" label="Loading brain entries" /> : null}
          </div>

          {sorted.length === 0 ? (
            <div className="px-3 py-3">
              <EmptyState
                variant="inline"
                title={searching ? 'No entries match that search.' : 'No brain entries yet.'}
                action={
                  searching ? (
                    <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => addTextRef.current?.focus()}
                    >
                      Add entry
                    </Button>
                  )
                }
                className="w-full"
              />
            </div>
          ) : (
            <ul
              aria-label="Brain entries"
              className="divide-y divide-border border-t border-border"
            >
              {sorted.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1.5 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Badge variant={entry.active ? 'primary' : 'neutral'} size="sm">
                      {BRAIN_KIND_LABEL[entry.kind]}
                    </Badge>
                    <span className="truncate text-2xs text-muted-foreground">
                      {brainEntryMeta(entry)}
                    </span>
                    <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                      {entry.active ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'text-xs leading-5 break-words whitespace-pre-wrap',
                      entry.active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {entry.text}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() => void toggleEntry(entry)}
                    >
                      {entry.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    {pendingDeleteId === entry.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId !== null}
                          onClick={() => void deleteEntry(entry)}
                        >
                          {busyId === entry.id ? (
                            <Spinner size="sm" label="Deleting entry" />
                          ) : null}
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId !== null}
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${BRAIN_KIND_LABEL[entry.kind].toLowerCase()} entry`}
                        size="sm"
                        className="ml-auto"
                        disabled={busyId !== null}
                        onClick={() => setPendingDeleteId(entry.id)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function PreviewGroups({ slice }: { slice: BrainSlice }) {
  return (
    <div className="flex flex-col gap-2">
      {slice.always.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium text-muted-foreground">Always</span>
          <PreviewEntries entries={slice.always} />
        </div>
      ) : null}
      {slice.retrieved.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium text-muted-foreground">Retrieved</span>
          <PreviewEntries entries={slice.retrieved} />
        </div>
      ) : null}
    </div>
  );
}

function PreviewEntries({ entries }: { entries: readonly BrainEntry[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="truncate rounded-sm bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
          title={entry.text}
        >
          <span className="text-foreground">{BRAIN_KIND_LABEL[entry.kind]}</span> {entry.text}
        </li>
      ))}
    </ul>
  );
}
