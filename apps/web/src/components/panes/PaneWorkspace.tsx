import type { Thread } from '@tuffcode/contracts';
import {
  IconButton,
  PopoverClose,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  buttonVariants,
  cn,
  focusRing,
} from '@tuffcode/ui';
import { Columns2, GripVertical, Plus, X, type LucideIcon } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useAppStore } from '../../store/app-store';
import { requestTerminalAt } from '../terminal/terminal-requests';
import {
  MAX_PANES,
  MAX_PANE_WIDTH_RATIO,
  MIN_PANE_WIDTH_PX,
  NARROW_PANE_WIDTH_PX,
  PANE_SURFACE_LABEL,
  addPane,
  addTab,
  availableSurfaces,
  clampLayoutWidths,
  closePane,
  closeTab,
  collapseToSinglePane,
  isPaneSurface,
  loadPaneLayout,
  moveTab,
  paneIdOfSurface,
  resetSplit,
  resizeSplit,
  savePaneLayout,
  selectTab,
  type PaneLayout,
  type PaneLayoutPane,
  type PaneSurface,
} from './pane-model';
import { PANE_SURFACE_ICON, PaneSurfaceView } from './pane-surfaces';

/** The drag payload between pane headers. */
const PANE_TAB_MIME = 'application/x-tuffcode-pane-tab';

export interface PaneWorkspaceProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

interface DragTab {
  paneId: string;
  surface: PaneSurface;
}

interface DropTarget {
  paneId: string;
  index: number;
}

/**
 * The thread row as one to three panes. Pane one always hosts the thread; every
 * other pane shows one of the shipped surfaces. Layout persists per thread, and
 * below 1100px the row keeps one pane whose tabs are every open surface.
 */
export function PaneWorkspace({ threadId, thread, projectName }: PaneWorkspaceProps) {
  const [layout, setLayout] = useState<PaneLayout>(() => loadPaneLayout(threadId));
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const [narrowTab, setNarrowTab] = useState<PaneSurface | null>(null);
  const [dragTab, setDragTab] = useState<DragTab | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const threadStageRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(containerRef);

  const closeSubagentPane = useAppStore((state) => state.closeSubagentPane);
  const subagentPaneOpen = useAppStore((state) => state.subagentPane.open);

  useEffect(() => {
    savePaneLayout(threadId, layout);
  }, [threadId, layout]);

  // A row that shrinks below the 70% / 280px bounds re-clamps instead of
  // overflowing. Narrow rows are a collapsed view, so they never rewrite the
  // stored wide layout.
  useEffect(() => {
    if (width <= 0 || width < NARROW_PANE_WIDTH_PX) return;
    setLayout((current) => clampLayoutWidths(current, width));
  }, [width]);

  const narrow = width > 0 && width < NARROW_PANE_WIDTH_PX;
  const collapsed = narrow ? collapseToSinglePane(layout) : null;
  const collapsedPane = collapsed?.panes[0];
  const narrowActive =
    collapsedPane !== undefined && narrowTab !== null && collapsedPane.tabs.includes(narrowTab)
      ? narrowTab
      : collapsedPane?.activeTab;
  const displayed: PaneLayout =
    narrow && collapsedPane !== undefined
      ? { panes: [{ ...collapsedPane, activeTab: narrowActive ?? collapsedPane.activeTab }] }
      : layout;

  const focusedPane =
    layout.panes.find((pane) => pane.id === focusedPaneId)?.id ?? layout.panes[0]?.id ?? null;
  const hasSubagentSurface = paneIdOfSurface(layout, 'subagent') !== null;
  const externalSubagentPane = hasSubagentSurface && (!narrow || narrowActive === 'subagent');

  const split = useCallback(
    (surface: PaneSurface) => {
      const next = addPane(layout, surface);
      if (next === layout) return;
      const added = next.panes[next.panes.length - 1];
      setLayout(next);
      if (added !== undefined) setFocusedPaneId(added.id);
      if (narrow) setNarrowTab(surface);
    },
    [layout, narrow],
  );

  const openTab = useCallback(
    (paneId: string, surface: PaneSurface) => {
      const owner = paneIdOfSurface(layout, surface);
      if (owner !== null) {
        setLayout(selectTab(layout, owner, surface));
        setFocusedPaneId(owner);
        if (narrow) setNarrowTab(surface);
        return;
      }
      const target = narrow ? (layout.panes[0]?.id ?? paneId) : paneId;
      setLayout(addTab(layout, target, surface));
      if (narrow) setNarrowTab(surface);
      else setFocusedPaneId(target);
    },
    [layout, narrow],
  );

  const removeTab = useCallback(
    (paneId: string, surface: PaneSurface) => {
      const owner = narrow ? paneIdOfSurface(layout, surface) : paneId;
      if (owner === null) return;
      const next = closeTab(layout, owner, surface);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(null);
      if (!next.panes.some((pane) => pane.id === focusedPaneId)) {
        setFocusedPaneId(next.panes[0]?.id ?? null);
      }
    },
    [focusedPaneId, layout, narrow],
  );

  const removePane = useCallback(
    (paneId: string) => {
      const next = closePane(layout, paneId);
      if (next === layout) return;
      setLayout(next);
      setFocusedPaneId(next.panes[0]?.id ?? null);
      if (narrow) setNarrowTab(null);
    },
    [layout, narrow],
  );

  const selectSurface = useCallback(
    (paneId: string, surface: PaneSurface) => {
      setFocusedPaneId(paneId);
      if (narrow) {
        setNarrowTab(surface);
        const owner = paneIdOfSurface(layout, surface);
        if (owner !== null) setLayout(selectTab(layout, owner, surface));
        return;
      }
      setLayout(selectTab(layout, paneId, surface));
    },
    [layout, narrow],
  );

  const closeSubagent = useCallback(() => {
    const owner = paneIdOfSurface(layout, 'subagent');
    closeSubagentPane();
    if (owner !== null) removeTab(owner, 'subagent');
  }, [closeSubagentPane, layout, removeTab]);

  // Opening a child from the timeline or its strip raises the surface's pane.
  // Only the closed-to-open transition acts, so the user can tab away while a
  // child is still running.
  const wasSubagentOpen = useRef(false);
  useEffect(() => {
    const opened = subagentPaneOpen && !wasSubagentOpen.current;
    wasSubagentOpen.current = subagentPaneOpen;
    if (!opened) return;
    const owner = paneIdOfSurface(layout, 'subagent');
    if (owner === null) return;
    const pane = layout.panes.find((entry) => entry.id === owner);
    if (pane === undefined || pane.activeTab === 'subagent') return;
    setLayout(selectTab(layout, owner, 'subagent'));
    setFocusedPaneId(owner);
    if (narrow) setNarrowTab('subagent');
  }, [layout, narrow, subagentPaneOpen]);

  const openInTerminal = useCallback(
    (paneId: string, path: string) => {
      openTab(paneId, 'terminal');
      requestTerminalAt(path);
    },
    [openTab],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLElement>, paneId: string, surface: PaneSurface) => {
      if (surface === 'thread') {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(PANE_TAB_MIME, JSON.stringify({ paneId, surface }));
      event.dataTransfer.setData('text/plain', PANE_SURFACE_LABEL[surface]);
      setDragTab({ paneId, surface });
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDragTab(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>, paneId: string) => {
      if (dragTab === null) return;
      if (dragTab.paneId === paneId) return;
      const target = layout.panes.find((pane) => pane.id === paneId);
      if (target === undefined || target.tabs.includes(dragTab.surface)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const index = dropIndex(event.currentTarget, event.clientX);
      setDropTarget((current) =>
        current !== null && current.paneId === paneId && current.index === index
          ? current
          : { paneId, index },
      );
    },
    [dragTab, layout],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget((current) => (current !== null && current.paneId === paneId ? null : current));
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>, paneId: string) => {
      event.preventDefault();
      const source = parseDragPayload(event.dataTransfer.getData(PANE_TAB_MIME)) ?? dragTab;
      const index = dropTarget !== null && dropTarget.paneId === paneId ? dropTarget.index : -1;
      setDragTab(null);
      setDropTarget(null);
      if (source === null) return;
      const next = moveTab(layout, source.paneId, source.surface, paneId, index);
      if (next === layout) return;
      setLayout(next);
      setFocusedPaneId(paneId);
      if (narrow) setNarrowTab(source.surface);
    },
    [dragTab, dropTarget, layout, narrow],
  );

  const resizeRef = useRef<{ index: number; startX: number; startLayout: PaneLayout } | null>(null);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeRef.current = { index, startX: event.clientX, startLayout: layout };
    },
    [layout],
  );

  const moveResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      const drag = resizeRef.current;
      if (drag === null || drag.index !== index) return;
      setLayout(resizeSplit(drag.startLayout, index, event.clientX - drag.startX, width));
    },
    [width],
  );

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (resizeRef.current?.index !== index) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Ctrl/Cmd+\ splits with the next surface; Ctrl/Cmd+W closes the focused pane.
  // Both yield to text fields and terminals, where the same chords mean edit or
  // signal.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === '\\') {
        const surface = availableSurfaces(layout)[0];
        if (surface === undefined) return;
        event.preventDefault();
        split(surface);
        return;
      }

      if (event.key.toLowerCase() === 'w' && !event.shiftKey) {
        if (narrow || layout.panes.length <= 1 || focusedPane === null) return;
        event.preventDefault();
        removePane(focusedPane);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedPane, layout, narrow, removePane, split]);

  const openSurfaces = availableSurfaces(layout);
  const canSplit = layout.panes.length < MAX_PANES && openSurfaces.length > 0;

  return (
    <div
      ref={containerRef}
      data-testid="pane-workspace"
      data-narrow={narrow ? 'true' : 'false'}
      data-pane-count={layout.panes.length}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1">
        {displayed.panes.map((pane, index) => {
          const focused = pane.id === focusedPane;
          return (
            <Fragment key={pane.id}>
              {index > 0 ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panes"
                  tabIndex={0}
                  data-testid="pane-splitter"
                  className={cn(
                    'group relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none bg-border select-none transition-colors duration-150 ease-out outline-none hover:bg-primary/50 focus-visible:bg-primary/40',
                  )}
                  onPointerDown={(event) => startResize(event, index - 1)}
                  onPointerMove={(event) => moveResize(event, index - 1)}
                  onPointerUp={(event) => endResize(event, index - 1)}
                  onPointerCancel={(event) => endResize(event, index - 1)}
                  onDoubleClick={() => setLayout(resetSplit(layout, index - 1))}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const step = event.shiftKey ? 48 : 16;
                    setLayout(
                      resizeSplit(
                        layout,
                        index - 1,
                        event.key === 'ArrowLeft' ? -step : step,
                        width,
                      ),
                    );
                  }}
                />
              ) : null}
              <section
                aria-label={`Pane ${index + 1}`}
                data-testid="pane"
                data-pane-id={pane.id}
                data-surface={pane.activeTab}
                data-focused={focused ? 'true' : undefined}
                style={{
                  flexGrow: pane.width,
                  flexBasis: 0,
                  maxWidth:
                    displayed.panes.length > 1 ? `${MAX_PANE_WIDTH_RATIO * 100}%` : undefined,
                  minWidth: narrow ? undefined : MIN_PANE_WIDTH_PX,
                }}
                className="flex min-w-0 flex-col overflow-hidden"
                onPointerDown={() => setFocusedPaneId(pane.id)}
              >
                <PaneHeader
                  pane={pane}
                  paneCount={displayed.panes.length}
                  focused={focused}
                  canClosePane={displayed.panes.length > 1 && !narrow && index > 0}
                  canSplit={canSplit}
                  openSurfaces={openSurfaces}
                  dropTarget={dropTarget}
                  onSelect={(surface) => selectSurface(pane.id, surface)}
                  onCloseTab={(surface) => removeTab(pane.id, surface)}
                  onAddTab={(surface) => openTab(pane.id, surface)}
                  onSplit={split}
                  onClosePane={() => removePane(pane.id)}
                  onDragStart={(event, surface) => handleDragStart(event, pane.id, surface)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(event) => handleDragOver(event, pane.id)}
                  onDragLeave={(event) => handleDragLeave(event, pane.id)}
                  onDrop={(event) => handleDrop(event, pane.id)}
                />
                <PaneBody
                  pane={pane}
                  threadId={threadId}
                  thread={thread}
                  projectName={projectName}
                  threadStageRef={threadStageRef}
                  externalSubagentPane={externalSubagentPane}
                  onOpenInTerminal={(path) => openInTerminal(pane.id, path)}
                  onCloseSubagent={closeSubagent}
                />
              </section>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

interface PaneHeaderProps {
  pane: PaneLayoutPane;
  paneCount: number;
  focused: boolean;
  canClosePane: boolean;
  canSplit: boolean;
  openSurfaces: readonly PaneSurface[];
  dropTarget: DropTarget | null;
  onSelect(surface: PaneSurface): void;
  onCloseTab(surface: PaneSurface): void;
  onAddTab(surface: PaneSurface): void;
  onSplit(surface: PaneSurface): void;
  onClosePane(): void;
  onDragStart(event: DragEvent<HTMLElement>, surface: PaneSurface): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
}

/**
 * Pane header: the drag handle, the surface tabs with the drop indicator, the
 * add-tab and split menus, and the close-pane control. The first pane's thread
 * tab has no close button and the pane itself never closes.
 */
function PaneHeader({
  pane,
  paneCount,
  focused,
  canClosePane,
  canSplit,
  openSurfaces,
  dropTarget,
  onSelect,
  onCloseTab,
  onAddTab,
  onSplit,
  onClosePane,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: PaneHeaderProps) {
  const showDropIndicator = dropTarget !== null && dropTarget.paneId === pane.id;
  const activeLabel = PANE_SURFACE_LABEL[pane.activeTab];

  return (
    <div
      data-testid="pane-header"
      data-pane-id={pane.id}
      data-drop-target={showDropIndicator ? 'true' : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background pr-1 pl-1.5',
        focused && paneCount > 1
          ? 'after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-primary/60'
          : null,
        showDropIndicator ? 'bg-primary/5 ring-1 ring-primary/40 ring-inset' : null,
      )}
    >
      <span
        draggable={pane.activeTab !== 'thread'}
        onDragStart={(event) => onDragStart(event, pane.activeTab)}
        onDragEnd={onDragEnd}
        title={
          pane.activeTab === 'thread'
            ? 'The thread stays in the first pane'
            : `Drag ${activeLabel} to another pane`
        }
        data-testid="pane-drag-handle"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50',
          pane.activeTab !== 'thread'
            ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing'
            : null,
        )}
      >
        <GripVertical aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </span>

      <div
        role="tablist"
        aria-label={`Pane ${pane.id} surfaces`}
        data-pane-tab-strip
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {pane.tabs.map((surface, index) => {
          const Icon = PANE_SURFACE_ICON[surface];
          const label = PANE_SURFACE_LABEL[surface];
          const active = surface === pane.activeTab;
          return (
            <Fragment key={surface}>
              {showDropIndicator && dropTarget.index === index ? <DropIndicator /> : null}
              <div
                data-testid="pane-tab"
                data-surface={surface}
                data-active={active ? 'true' : 'false'}
                draggable={surface !== 'thread'}
                onDragStart={(event) => onDragStart(event, surface)}
                onDragEnd={onDragEnd}
                className={cn(
                  'flex h-6 shrink-0 items-center rounded-sm transition-colors duration-150 ease-out',
                  active
                    ? 'bg-surface-raised text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid="pane-tab-button"
                  onClick={() => onSelect(surface)}
                  className={cn(
                    'flex h-full min-w-0 items-center gap-1 rounded-sm pr-1 pl-2 text-2xs font-medium',
                    focusRing,
                  )}
                >
                  <Icon aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
                  <span className="max-w-24 truncate">{label}</span>
                </button>
                {surface === 'thread' ? null : (
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    data-testid="pane-tab-close"
                    onClick={() => onCloseTab(surface)}
                    className={cn(
                      'mr-0.5 flex size-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground',
                      focusRing,
                    )}
                  >
                    <X aria-hidden="true" strokeWidth={1.75} className="size-3" />
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
        {showDropIndicator && dropTarget.index >= pane.tabs.length ? <DropIndicator /> : null}
      </div>

      <PaneSurfaceMenu
        testId="pane-add-tab"
        itemTestId="pane-add-surface"
        label="Open a surface in this pane"
        icon={Plus}
        surfaces={openSurfaces}
        onPick={onAddTab}
      />
      <PaneSurfaceMenu
        testId="pane-split"
        itemTestId="pane-split-surface"
        label="Split pane"
        icon={Columns2}
        surfaces={canSplit ? openSurfaces : []}
        onPick={onSplit}
        disabled={!canSplit}
      />
      {canClosePane ? (
        <IconButton
          icon={X}
          label="Close pane"
          size="sm"
          data-testid="pane-close"
          className="shrink-0"
          onClick={onClosePane}
        />
      ) : null}
    </div>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden="true"
      data-testid="pane-drop-indicator"
      className="h-4 w-0.5 shrink-0 rounded-full bg-primary"
    />
  );
}

interface PaneSurfaceMenuProps {
  testId: string;
  itemTestId: string;
  label: string;
  icon: LucideIcon;
  surfaces: readonly PaneSurface[];
  onPick(surface: PaneSurface): void;
  disabled?: boolean;
}

function PaneSurfaceMenu({
  testId,
  itemTestId,
  label,
  icon: Icon,
  surfaces,
  onPick,
  disabled = false,
}: PaneSurfaceMenuProps) {
  return (
    <PopoverRoot>
      <PopoverTrigger
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0')}
      >
        <Icon strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 p-1">
        {surfaces.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">Every surface is open.</p>
        ) : (
          surfaces.map((surface) => {
            const SurfaceIcon = PANE_SURFACE_ICON[surface];
            return (
              <PopoverClose
                key={surface}
                data-testid={`${itemTestId}-${surface}`}
                onClick={() => onPick(surface)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent',
                  focusRing,
                )}
              >
                <SurfaceIcon
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5 text-muted-foreground"
                />
                {PANE_SURFACE_LABEL[surface]}
              </PopoverClose>
            );
          })
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

interface PaneBodyProps {
  pane: PaneLayoutPane;
  threadId: string;
  thread?: Thread;
  projectName?: string;
  threadStageRef: RefObject<HTMLDivElement | null>;
  externalSubagentPane: boolean;
  onOpenInTerminal(path: string): void;
  onCloseSubagent(): void;
}

/**
 * Keeps every visited surface mounted so switching tabs does not close a
 * terminal or drop a diff comment. The thread surface stays mounted from the
 * start: it owns the stream subscription and the composer.
 */
function PaneBody({
  pane,
  threadId,
  thread,
  projectName,
  threadStageRef,
  externalSubagentPane,
  onOpenInTerminal,
  onCloseSubagent,
}: PaneBodyProps) {
  const [mounted, setMounted] = useState<PaneSurface[]>(() =>
    pane.tabs.includes('thread')
      ? ['thread', ...(pane.activeTab === 'thread' ? [] : [pane.activeTab])]
      : [pane.activeTab],
  );

  useEffect(() => {
    setMounted((current) =>
      current.includes(pane.activeTab) ? current : [...current, pane.activeTab],
    );
  }, [pane.activeTab]);

  const surfaces = mounted.filter((surface) => pane.tabs.includes(surface));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {surfaces.map((surface) => {
        const active = surface === pane.activeTab;
        return (
          <div
            key={surface}
            role="tabpanel"
            aria-label={PANE_SURFACE_LABEL[surface]}
            data-testid="pane-surface"
            data-surface={surface}
            data-active={active ? 'true' : 'false'}
            style={{ display: active ? 'flex' : 'none' }}
            className="min-h-0 flex-1 flex-col"
          >
            <PaneSurfaceView
              surface={surface}
              threadId={threadId}
              thread={thread}
              projectName={projectName}
              threadStageRef={threadStageRef}
              externalSubagentPane={externalSubagentPane}
              onOpenInTerminal={onOpenInTerminal}
              onCloseSubagent={onCloseSubagent}
            />
          </div>
        );
      })}
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/** The insertion point among the target header's tabs, in tab order. */
function dropIndex(header: HTMLElement, clientX: number): number {
  const tabs = [...header.querySelectorAll<HTMLElement>('[data-pane-tab]')];
  let index = 0;
  for (const tab of tabs) {
    const box = tab.getBoundingClientRect();
    if (clientX > box.left + box.width / 2) index += 1;
  }
  return index;
}

function parseDragPayload(raw: string): DragTab | null {
  if (raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!('paneId' in parsed) || !('surface' in parsed)) return null;
    if (typeof parsed.paneId !== 'string' || !isPaneSurface(parsed.surface)) return null;
    return { paneId: parsed.paneId, surface: parsed.surface };
  } catch {
    return null;
  }
}

/** Ctrl+W and Ctrl+\ belong to the shell and to text fields, not the pane row. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-terminal-id], .xterm')) return true;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [role="textbox"]') !== null;
}
