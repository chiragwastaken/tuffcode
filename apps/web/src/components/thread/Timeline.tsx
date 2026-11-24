import { useVirtualizer } from '@tanstack/react-virtual';
import type { MarkdownTheme } from '@tuffcode/ui';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ApprovalCard } from './ApprovalCard';
import type { TimelineItem } from './grouping';
import {
  AssistantMessage,
  NoticeRow,
  ReasoningRow,
  ToolGroupRow,
  ToolRow,
  UserBubble,
} from './timeline-items';

export interface TimelineProps {
  items: TimelineItem[];
  theme: MarkdownTheme;
  threadId: string;
}

const BOTTOM_THRESHOLD_PX = 64;

function renderItem(item: TimelineItem, theme: MarkdownTheme, threadId: string): ReactNode {
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} />;
    case 'assistant':
      return <AssistantMessage item={item} theme={theme} />;
    case 'reasoning':
      return <ReasoningRow item={item} />;
    case 'tool':
      return <ToolRow item={item} />;
    case 'tool-group':
      return <ToolGroupRow item={item} />;
    case 'approval':
      return <ApprovalCard item={item} threadId={threadId} />;
    case 'notice':
      return <NoticeRow item={item} />;
  }
}

export function Timeline({ items, theme, threadId }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  useLayoutEffect(() => {
    if (items.length === 0 || !pinnedRef.current) return;
    virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
  }, [items, virtualizer]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Thread timeline"
      aria-live="polite"
      className="min-h-0 flex-1 scroll-pt-3 overflow-y-auto overscroll-contain py-4"
      onScroll={() => {
        const element = scrollRef.current;
        if (!element) return;
        pinnedRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD_PX;
      }}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full py-1.5"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="mx-auto w-full max-w-[var(--chat-content-max-width)] px-4">
                {renderItem(item, theme, threadId)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
