import type { BrainEntry, BrainKind, BrainSlice, RpcParams, RpcResult } from '@tuffcode/contracts';
import { Button, IconButton, Input, ScrollArea, Select, Spinner } from '@tuffcode/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { BrainAddForm, BrainList, type BrainListRow } from '../brain/BrainList';
import { BrainDetails, type BrainEntryPatch } from '../brain/BrainDetails';
import { BrainGraph } from '../brain/BrainGraph';
import {
  createDebouncedRunner,
  filterByKind,
  sortGraphNodes,
  type DebouncedRunner,
} from '../brain/brain-search';
import type { BrainGraphEdge, BrainGraphNode } from '../brain/graph-layout';
import {
  BRAIN_KIND_LABEL,
  BRAIN_KINDS,
  toggleBrainEntryParams,
  updateBrainEntryParams,
} from './brain-model';

export interface BrainPanelProps {
  threadId: string;
  projectId: string | null;
}

type MemorySearchEntry = RpcResult<'memory.search'>['entries'][number];

const SEARCH_DEBOUNCE_MS = 150;
const PREVIEW_DEBOUNCE_MS = 250;
const PREVIEW_MESSAGE_MAX = 500;
const ENTRY_LIMIT = 300;

const EMPTY_NODES: readonly BrainGraphNode[] = [];
const EMPTY_EDGES: readonly BrainGraphEdge[] = [];

const KIND_FILTER_OPTIONS = [
  { value: 'all', label: 'All kinds' },
  ...BRAIN_KINDS.map((kind) => ({ value: kind, label: BRAIN_KIND_LABEL[kind] })),
];

function isBrainKind(value: string): value is BrainKind {
  return (BRAIN_KINDS as readonly string[]).includes(value);
}

function brainErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return 'The brain request failed.';
}

function mergeEntries(groups: readonly BrainEntry[][]): Map<string, BrainEntry> {
  const byId = new Map<string, BrainEntry>();
  for (const group of groups) {
    for (const entry of group) byId.set(entry.id, entry);
  }
  return byId;
}

/**
 * Brain inspector, spec section 7.7: an interactive force graph with a searchable
 * kind-filtered list on the left and the selected entry's details on the right.
 * Search runs `memory.search` as you type so the list explains the selector's own
 * ranking, while the graph and details read from `brain.graph` and `brain.list`.
 */
export function BrainPanel({ threadId, projectId }: BrainPanelProps) {
  const rpc = useRpc();

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<BrainKind | null>(null);

  const [graphNodes, setGraphNodes] = useState<readonly BrainGraphNode[]>(EMPTY_NODES);
  const [graphEdges, setGraphEdges] = useState<readonly BrainGraphEdge[]>(EMPTY_EDGES);
  const [entries, setEntries] = useState<Map<string, BrainEntry>>(new Map());
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [searchResults, setSearchResults] = useState<readonly MemorySearchEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slice, setSlice] = useState<BrainSlice | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<BrainKind>('rule');
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGraphLoading(true);
    const graphParams: RpcParams<'brain.graph'> = projectId === null ? {} : { projectId };
    const listParams: RpcParams<'brain.list'> = {
      includeInactive: true,
      limit: ENTRY_LIMIT,
    };

    void Promise.all([
      rpc.request('brain.graph', graphParams),
      rpc.request('brain.list', listParams),
      projectId === null
        ? Promise.resolve([] as BrainEntry[])
        : rpc.request('brain.list', { ...listParams, projectId }),
    ])
      .then(([graph, allEntries, projectEntries]) => {
        if (cancelled) return;
        setGraphNodes(graph.nodes);
        setGraphEdges(graph.edges);
        setEntries(mergeEntries([allEntries, projectEntries]));
        setGraphError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setGraphError(brainErrorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, reloadToken]);

  const searchTokenRef = useRef(0);
  const searchRunRef = useRef<(value: string) => void>(() => {});
  const searchRunnerRef = useRef<DebouncedRunner<string> | null>(null);

  useEffect(() => {
    const runner = createDebouncedRunner<string>(SEARCH_DEBOUNCE_MS, (value) => {
      searchRunRef.current(value);
    });
    searchRunnerRef.current = runner;
    return () => {
      runner.cancel();
      searchRunnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    searchRunRef.current = (value: string) => {
      const token = searchTokenRef.current + 1;
      searchTokenRef.current = token;
      const params: RpcParams<'memory.search'> = {
        query: value,
        ...(projectId === null ? {} : { projectId }),
      };
      void rpc
        .request('memory.search', params)
        .then((result) => {
          if (!mountedRef.current || token !== searchTokenRef.current) return;
          setSearchResults(result.entries);
          setSearchError(null);
        })
        .catch((cause: unknown) => {
          if (!mountedRef.current || token !== searchTokenRef.current) return;
          setSearchResults([]);
          setSearchError(brainErrorMessage(cause));
        })
        .finally(() => {
          if (mountedRef.current && token === searchTokenRef.current) setSearchLoading(false);
        });
    };
  }, [rpc, projectId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      searchRunnerRef.current?.cancel();
      searchTokenRef.current += 1;
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    searchRunnerRef.current?.schedule(trimmed);
  }, [query, reloadToken]);

  const selectedEntry = selectedId === null ? null : (entries.get(selectedId) ?? null);
  const selectedNode = useMemo(
    () =>
      selectedId === null ? null : (graphNodes.find((node) => node.id === selectedId) ?? null),
    [graphNodes, selectedId],
  );

  const previewMessage = useMemo(() => {
    const typed = query.trim();
    const source = typed.length > 0 ? typed : (selectedEntry?.text ?? '');
    return source.slice(0, PREVIEW_MESSAGE_MAX);
  }, [query, selectedEntry?.text]);

  useEffect(() => {
    if (projectId === null) {
      setSlice(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      void rpc
        .request('brain.preview', { projectId, threadId, message: previewMessage })
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
  }, [rpc, projectId, threadId, previewMessage, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    setActionError(null);
  }, []);

  async function addEntry(): Promise<void> {
    const text = addText.trim();
    if (text.length === 0 || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const created = await rpc.request('brain.upsert', {
        kind: addKind,
        scope: 'global',
        text,
      });
      if (!mountedRef.current) return;
      setEntries((current) => new Map(current).set(created.id, created));
      setAddText('');
      setAddOpen(false);
      setSelectedId(created.id);
      refresh();
    } catch (cause) {
      if (mountedRef.current) setAddError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setAdding(false);
    }
  }

  async function saveEntry(patch: BrainEntryPatch): Promise<void> {
    if (selectedEntry === null || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await rpc.request(
        'brain.upsert',
        updateBrainEntryParams(selectedEntry, patch),
      );
      if (!mountedRef.current) return;
      setEntries((current) => new Map(current).set(updated.id, updated));
      refresh();
    } catch (cause) {
      if (mountedRef.current) setActionError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function toggleSelected(): Promise<void> {
    if (selectedEntry === null || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await rpc.request('brain.upsert', toggleBrainEntryParams(selectedEntry));
      if (!mountedRef.current) return;
      setEntries((current) => new Map(current).set(updated.id, updated));
      refresh();
    } catch (cause) {
      if (mountedRef.current) setActionError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selectedEntry === null || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await rpc.request('brain.delete', { id: selectedEntry.id });
      if (!mountedRef.current) return;
      setEntries((current) => {
        const next = new Map(current);
        next.delete(selectedEntry.id);
        return next;
      });
      setSelectedId(null);
      refresh();
    } catch (cause) {
      if (mountedRef.current) setActionError(brainErrorMessage(cause));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const searching = query.trim().length > 0;
  const visibleNodes = useMemo(
    () => filterByKind(sortGraphNodes(graphNodes), kindFilter),
    [graphNodes, kindFilter],
  );
  const visibleResults = useMemo(
    () => filterByKind(searchResults, kindFilter),
    [searchResults, kindFilter],
  );

  // The graph only carries active entries, so inactive rows come from the entry
  // map; without them deactivating an entry would remove every way to re-enable it.
  const inactiveRows = useMemo<BrainListRow[]>(() => {
    const nodeIds = new Set(graphNodes.map((node) => node.id));
    return [...entries.values()]
      .filter(
        (entry) =>
          !entry.active &&
          !nodeIds.has(entry.id) &&
          (entry.projectId === null || entry.projectId === projectId) &&
          (kindFilter === null || entry.kind === kindFilter),
      )
      .toSorted((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
        importance: entry.importance,
        active: false,
      }));
  }, [entries, graphNodes, projectId, kindFilter]);

  const rows = useMemo<BrainListRow[]>(() => {
    if (searching) {
      return visibleResults.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
        score: entry.score,
        reason: entry.reason,
      }));
    }
    const graphRows = visibleNodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      text: node.label,
      importance: node.importance,
      degree: node.degree,
    }));
    return [...graphRows, ...inactiveRows];
  }, [searching, visibleResults, visibleNodes, inactiveRows]);

  const searchHit = useMemo(
    () =>
      selectedId === null ? null : (searchResults.find((entry) => entry.id === selectedId) ?? null),
    [searchResults, selectedId],
  );

  return (
    <section
      aria-label="Brain"
      data-testid="brain-panel"
      className="@container flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-[var(--row-height)] shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Input
          type="search"
          className="h-7 text-xs"
          placeholder="Search memories"
          aria-label="Search brain entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton
          icon={RefreshCw}
          label="Refresh brain"
          size="sm"
          disabled={graphLoading}
          onClick={refresh}
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
        {selectedId !== null ? null : (
          <aside
            aria-label="Brain list"
            className="flex w-[172px] shrink-0 flex-col border-r border-border"
          >
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-1.5">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="Filter by kind"
                  className="h-6 text-2xs"
                  options={KIND_FILTER_OPTIONS}
                  value={kindFilter ?? 'all'}
                  onValueChange={(value) => {
                    setKindFilter(
                      value === null || value === 'all' || !isBrainKind(value) ? null : value,
                    );
                  }}
                />
              </div>
              <IconButton
                icon={Plus}
                label={addOpen ? 'Close new entry form' : 'Add brain entry'}
                size="sm"
                aria-expanded={addOpen}
                onClick={() => setAddOpen((open) => !open)}
              />
            </div>

            {addOpen ? (
              <BrainAddForm
                kind={addKind}
                text={addText}
                adding={adding}
                error={addError}
                onKindChange={setAddKind}
                onTextChange={setAddText}
                onSubmit={() => void addEntry()}
                onCancel={() => setAddOpen(false)}
              />
            ) : null}

            <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-2xs text-muted-foreground">
              <span>{searching ? 'Results' : 'Entries'}</span>
              <span className="tabular-nums">{rows.length}</span>
              {searchLoading ? <Spinner size="sm" label="Searching memories" /> : null}
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <BrainList
                rows={rows}
                loading={searching ? searchLoading : graphLoading}
                error={searching ? searchError : graphError}
                searching={searching}
                selectedId={selectedId}
                emptyAction={
                  <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                    Add
                  </Button>
                }
                onSelect={handleSelect}
                onClearSearch={() => setQuery('')}
              />
            </ScrollArea>
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <BrainGraph
            nodes={visibleNodes}
            edges={graphEdges}
            selectedId={selectedId}
            loading={graphLoading}
            error={graphError}
            onSelect={handleSelect}
            onRetry={refresh}
          />
        </div>

        {selectedId === null ? null : (
          <BrainDetails
            entry={selectedEntry}
            node={selectedNode}
            slice={slice}
            previewMessage={previewMessage}
            previewLoading={previewLoading}
            previewError={previewError}
            searchHit={
              searchHit === null ? null : { score: searchHit.score, reason: searchHit.reason }
            }
            busy={busy}
            actionError={actionError}
            onRefresh={refresh}
            onClose={() => handleSelect(null)}
            onSave={(patch) => void saveEntry(patch)}
            onToggle={() => void toggleSelected()}
            onDelete={() => void deleteSelected()}
          />
        )}
      </div>
    </section>
  );
}
