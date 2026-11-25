import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, EmptyState, IconButton, Input, Spinner, cn } from '@tuffcode/ui';
import { ChevronDown, ChevronRight, File, Folder, RefreshCw, SquareTerminal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { buildFileTree, toggleExpanded, visibleRows, type FileNode } from './files-model';

export interface FilesPanelProps {
  threadId: string;
  onOpenInTerminal?: (path: string) => void;
}

type TreeState =
  | { status: 'loading' }
  | { status: 'ready'; root: FileNode; count: number; truncated: boolean }
  | { status: 'error'; message: string };

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; text: string; truncated: boolean; binary: boolean }
  | { status: 'error'; path: string; message: string };

const ROW_HEIGHT = 26;

/**
 * Files explorer for the thread worktree: one listing per open, a filter box (plain
 * substring, or `?` for in-order fuzzy matching), and a read-only preview. The tree is
 * virtualized, so a 20k-file repository scrolls without building 20k rows.
 */
export function FilesPanel({ threadId, onOpenInTerminal }: FilesPanelProps) {
  const rpc = useRpc();
  const [tree, setTree] = useState<TreeState>({ status: 'loading' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setTree({ status: 'loading' });
    rpc
      .request('files.tree', { threadId })
      .then((result) =>
        setTree({
          status: 'ready',
          root: buildFileTree(result.paths),
          count: result.paths.length,
          truncated: result.truncated,
        }),
      )
      .catch((error: unknown) =>
        setTree({ status: 'error', message: error instanceof Error ? error.message : 'Could not list files.' }),
      );
  }, [rpc, threadId]);

  useEffect(() => {
    load();
    setPreview({ status: 'idle' });
  }, [load]);

  const rows = useMemo(
    () => (tree.status === 'ready' ? visibleRows(tree.root, expanded, query) : []),
    [tree, expanded, query],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const openFile = useCallback(
    (path: string) => {
      setPreview({ status: 'loading', path });
      rpc
        .request('files.read', { threadId, path })
        .then((result) => setPreview({ status: 'ready', path, ...result }))
        .catch((error: unknown) =>
          setPreview({
            status: 'error',
            path,
            message: error instanceof Error ? error.message : 'Could not read the file.',
          }),
        );
    },
    [rpc, threadId],
  );

  if (preview.status !== 'idle') {
    return (
      <div data-testid="files-preview" className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground" title={preview.path}>
            {preview.path}
          </span>
          {onOpenInTerminal ? (
            <IconButton
              icon={SquareTerminal}
              label="Open folder in terminal"
              size="sm"
              onClick={() => onOpenInTerminal(preview.path.split('/').slice(0, -1).join('/') || '.')}
            />
          ) : null}
          <IconButton icon={X} label="Back to files" size="sm" onClick={() => setPreview({ status: 'idle' })} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {preview.status === 'loading' ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : preview.status === 'error' ? (
            <EmptyState variant="inline" title="Could not open the file" description={preview.message} />
          ) : preview.binary ? (
            <EmptyState variant="inline" title="Binary file" description="This file is not text, so there is nothing to preview." />
          ) : (
            <pre className="p-3 font-mono text-2xs leading-5 whitespace-pre text-foreground">
              {preview.text}
              {preview.truncated ? '\n\n[preview truncated at 256 KB]' : ''}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="files-panel" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter, or ? to search in files"
          aria-label="Filter files"
          spellCheck={false}
          className="h-7 flex-1 text-xs"
          data-testid="files-filter"
        />
        <IconButton icon={RefreshCw} label="Reload files" size="sm" onClick={load} />
      </div>
      {tree.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : tree.status === 'error' ? (
        <div className="p-3">
          <EmptyState
            variant="inline"
            title="Could not list files"
            description={tree.message}
            action={
              <Button size="sm" variant="outline" onClick={load}>
                Try again
              </Button>
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-3">
          <EmptyState variant="inline" title={query.length > 0 ? 'No matching files' : 'No files yet'} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="Project files">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              const isDir = row.node.kind === 'dir';
              const Chevron = row.expanded ? ChevronDown : ChevronRight;
              const Icon = isDir ? Folder : File;
              return (
                <button
                  key={row.node.path}
                  type="button"
                  role="treeitem"
                  aria-expanded={isDir ? row.expanded : undefined}
                  data-testid="files-row"
                  title={row.node.path}
                  onClick={() =>
                    isDir ? setExpanded((current) => toggleExpanded(current, row.node.path)) : openFile(row.node.path)
                  }
                  className={cn(
                    'absolute left-0 flex w-full items-center gap-1 pr-2 text-left text-xs text-foreground hover:bg-accent',
                    isDir ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
                  )}
                  style={{ top: item.start, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 14 }}
                >
                  {isDir ? <Chevron className="size-3 shrink-0" strokeWidth={1.75} /> : <span className="w-3 shrink-0" />}
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{row.node.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {tree.status === 'ready' ? (
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-muted-foreground tabular-nums">
          {tree.count} files{tree.truncated ? ' (list capped at 20000)' : ''}
        </div>
      ) : null}
    </div>
  );
}
