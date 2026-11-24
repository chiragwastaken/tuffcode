import { cn, type MarkdownTheme } from '@tuffcode/ui';
import { Badge, IconButton, StatusDot, TabsList, TabsPanel, TabsRoot, TabsTab } from '@tuffcode/ui';
import { CircleStop, PanelRightClose } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { formatDuration } from '../thread/turn-blocks';
import { useConnectorGeometry } from './connector';
import {
  SUBAGENT_PANE_WIDTH_PERCENT,
  SUBAGENT_STATUS_LABEL,
  SUBAGENT_STATUS_TONE,
  SUBAGENT_TYPE_ICON,
  SUBAGENT_TYPE_LABEL,
  isRunningSubagent,
  selectActiveSubagent,
  subagentElapsedMs,
  subagentsOfThread,
} from './subagent-model';
import { SubagentTimeline } from './SubagentTimeline';
import { useSubagentClock } from './use-subagents';

export interface SubagentPaneProps {
  threadId: string;
  /** The row that holds the cards and this pane; the connector is measured in it. */
  stageRef: RefObject<HTMLElement | null>;
  theme: MarkdownTheme;
  onSelect(childId: string): void;
  onClose(): void;
}

/**
 * Right-hand child pane: one tab per child, the selected child's timeline, and a
 * 1px connector back to that child's card in the parent timeline.
 */
export function SubagentPane({ threadId, stageRef, theme, onSelect, onClose }: SubagentPaneProps) {
  const rpc = useRpc();
  const subagents = useAppStore(
    useShallow((state) => subagentsOfThread(state.subagents, threadId)),
  );
  const activeChildId = useAppStore((state) => state.subagentPane.activeChildId);
  const active = selectActiveSubagent(subagents, activeChildId);
  const now = useSubagentClock(subagents);

  const paneRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [cancelling, setCancelling] = useState(false);

  const geometry = useConnectorGeometry({
    rootRef: stageRef,
    originRef: paneRef,
    headerRef,
    revision: `${active?.childId ?? 'none'}:${subagents.length}`,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (active === null) return null;

  const ActiveIcon = SUBAGENT_TYPE_ICON[active.type];
  const elapsed = formatDuration(subagentElapsedMs(active, now));
  const running = isRunningSubagent(active);

  async function cancel(childId: string): Promise<void> {
    setCancelling(true);
    try {
      await rpc.request('subagents.cancel', { childId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not cancel the subagent.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      ref={paneRef}
      data-testid="subagent-pane"
      data-slot="right-panel"
      aria-label="Subagent"
      data-pane-width={SUBAGENT_PANE_WIDTH_PERCENT}
      style={{ '--subagent-pane-width': `${SUBAGENT_PANE_WIDTH_PERCENT}%` } as CSSProperties}
      className={cn(
        'relative flex min-h-0 w-[var(--subagent-pane-width)] min-w-[18rem] max-w-[36rem] shrink-0 flex-col border-l border-border bg-background',
        // Below ~56rem of thread row the pane would leave the timeline and composer
        // unusable, so it overlays the row instead of squeezing it (the inspector
        // already owns a column on wide windows).
        '@max-[56rem]:absolute @max-[56rem]:top-0 @max-[56rem]:right-0 @max-[56rem]:bottom-[var(--subagent-dock-height,0px)] @max-[56rem]:z-30 @max-[56rem]:w-[min(26rem,92%)] @max-[56rem]:border-l-primary/30 @max-[56rem]:shadow-2xl',
      )}
    >
      {geometry ? (
        <svg
          aria-hidden="true"
          data-testid="subagent-connector"
          data-connector-d={geometry.d}
          width="1"
          height="1"
          className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
        >
          <path
            d={geometry.d}
            fill="none"
            stroke="var(--primary)"
            strokeOpacity="0.55"
            strokeWidth="1"
          />
          <circle cx={geometry.x1} cy={geometry.y1} r="2.5" fill="var(--primary)" />
        </svg>
      ) : null}

      <TabsRoot
        value={active.childId}
        onValueChange={(value) => {
          if (typeof value === 'string') onSelect(value);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={headerRef}
          data-testid="subagent-pane-header"
          className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <ActiveIcon aria-hidden="true" strokeWidth={1.75} className="size-3" />
          </span>
          <Badge variant="outline" size="sm" className="shrink-0">
            {SUBAGENT_TYPE_LABEL[active.type]}
          </Badge>
          {active.model.length > 0 ? (
            <span
              data-testid="subagent-pane-model"
              title={active.model}
              className="min-w-0 max-w-32 truncate font-mono text-2xs text-muted-foreground"
            >
              {active.model}
            </span>
          ) : null}
          <span className="flex shrink-0 items-center gap-1">
            <StatusDot status={SUBAGENT_STATUS_TONE[active.status]} />
            <span
              data-testid="subagent-pane-status"
              data-status={active.status}
              className="text-2xs text-muted-foreground"
            >
              {SUBAGENT_STATUS_LABEL[active.status]}
            </span>
          </span>
          {elapsed.length > 0 ? (
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/70">
              {elapsed}
            </span>
          ) : null}

          <span className="min-w-0 flex-1" />

          {running ? (
            <IconButton
              icon={CircleStop}
              label="Cancel subagent"
              size="sm"
              disabled={cancelling}
              data-testid="subagent-cancel"
              className="shrink-0"
              onClick={() => void cancel(active.childId)}
            />
          ) : null}
          <IconButton
            icon={PanelRightClose}
            label="Close subagent pane"
            size="sm"
            data-testid="subagent-pane-close"
            className="shrink-0"
            onClick={onClose}
          />
        </div>

        {subagents.length > 1 ? (
          <div
            data-testid="subagent-tabs"
            className="shrink-0 overflow-x-auto border-b border-border px-2 py-1.5"
          >
            <TabsList aria-label="Subagent children" className="min-w-0">
              {subagents.map((child) => {
                const Icon = SUBAGENT_TYPE_ICON[child.type];
                return (
                  <TabsTab
                    key={child.childId}
                    value={child.childId}
                    data-testid="subagent-tab"
                    data-child-id={child.childId}
                    className="gap-1"
                  >
                    <Icon aria-hidden="true" strokeWidth={1.75} className="size-3" />
                    <span className="max-w-24 truncate">{SUBAGENT_TYPE_LABEL[child.type]}</span>
                    <StatusDot status={SUBAGENT_STATUS_TONE[child.status]} />
                  </TabsTab>
                );
              })}
            </TabsList>
          </div>
        ) : null}

        {subagents.map((child) => (
          <TabsPanel
            key={child.childId}
            value={child.childId}
            keepMounted
            className="flex min-h-0 flex-1 flex-col"
          >
            <SubagentTimeline child={child} theme={theme} />
          </TabsPanel>
        ))}
      </TabsRoot>
    </div>
  );
}
