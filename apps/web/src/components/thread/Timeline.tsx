import { useVirtualizer } from '@tanstack/react-virtual';
import type { MarkdownTheme } from '@tuffcode/ui';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { ApprovalCard } from './ApprovalCard';
import type { TimelineItem, UserItem } from './grouping';
import {
  FinalAnswer,
  NoticeRow,
  ProseText,
  ReasoningRow,
  ToolGroup,
  UserBubble,
} from './timeline-items';
import { groupTurnBlocks, type TimelineBlock } from './turn-blocks';

export interface TimelineProps {
  items: TimelineItem[];
  theme: MarkdownTheme;
  threadId: string;
  onRetryUserMessage?: (item: UserItem) => void;
  onEditUserMessage?: (item: UserItem, text: string) => void;
}

const BOTTOM_THRESHOLD_PX = 64;

function renderBlock(
  block: TimelineBlock,
  theme: MarkdownTheme,
  threadId: string,
  onRetryUserMessage?: (item: UserItem) => void,
  onEditUserMessage?: (item: UserItem, text: string) => void,
): ReactNode {
  switch (block.kind) {
    case 'user':
      return <UserBubble item={block.item} onRetry={onRetryUserMessage} />;
    case 'reasoning':
      return <ReasoningRow block={block} />;
    case 'prose':
      return <ProseText block={block} theme={theme} />;
    case 'tools':
      return <ToolGroup block={block} />;
    case 'final':
      return (
        <FinalAnswer
          block={block}
          theme={theme}
          onRetry={onRetryUserMessage}
          onEdit={onEditUserMessage}
        />
      );
    case 'approval':
      return <ApprovalCard item={block.item} threadId={threadId} />;
    case 'notice':
      return <NoticeRow item={block.item} />;
  }
}

export function Timeline({
  items,
  theme,
  threadId,
  onRetryUserMessage,
  onEditUserMessage,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const blocks = useMemo(() => groupTurnBlocks(items), [items]);

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (index) => blocks[index]?.key ?? index,
  });

  useLayoutEffect(() => {
    if (blocks.length === 0 || !pinnedRef.current) return;
    virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' });
  }, [blocks, virtualizer]);

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
          const block = blocks[virtualRow.index];
          if (!block) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full py-1.5"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="mx-auto w-full max-w-[var(--chat-content-max-width)] px-4">
                {renderBlock(block, theme, threadId, onRetryUserMessage, onEditUserMessage)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
