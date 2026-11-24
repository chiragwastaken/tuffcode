import { MultiFileDiff } from '@pierre/diffs/react';
import { MessageSquarePlus } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from './cn';
import { EmptyState } from './empty-state';

export interface DiffFile {
  path: string;
  oldText: string;
  newText: string;
}

export interface DiffLineComment {
  path: string;
  /** 1-based line number on the requested side. */
  line: number;
  side: 'old' | 'new';
}

export interface DiffViewerProps {
  files: readonly DiffFile[];
  /** Renders a gutter button per line; clicking it reports the hovered line. */
  onLineComment?: (comment: DiffLineComment) => void;
  /** Suppresses the per-file header when the caller already shows one. */
  hideFileHeader?: boolean;
  theme?: 'dark' | 'light';
  diffStyle?: 'unified' | 'split';
  className?: string;
}

/**
 * Multi-file diff built on `@pierre/diffs` React `MultiFileDiff`, one instance
 * per file. The library injects its own styles into a shadow root, so no CSS
 * import is required; fonts are pointed at the design system mono stack.
 */
export function DiffViewer({
  files,
  onLineComment,
  hideFileHeader = false,
  theme = 'dark',
  diffStyle = 'unified',
  className,
}: DiffViewerProps) {
  if (files.length === 0) {
    return (
      <EmptyState title="No changes" description="Nothing has changed in this worktree yet." />
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {files.map((file) => (
        <div
          key={file.path}
          className="overflow-hidden rounded-md border border-border bg-surface-raised"
          style={
            {
              '--diffs-font-family': 'var(--font-mono)',
              '--diffs-header-font-family': 'var(--font-sans)',
            } as CSSProperties
          }
        >
          <MultiFileDiff
            oldFile={{ name: file.path, contents: file.oldText }}
            newFile={{ name: file.path, contents: file.newText }}
            options={{
              themeType: theme,
              diffStyle,
              overflow: 'wrap',
              lineDiffType: 'word-alt',
              disableFileHeader: hideFileHeader,
            }}
            renderGutterUtility={
              onLineComment
                ? (getHoveredLine) => (
                    <button
                      type="button"
                      aria-label={`Comment on ${file.path}`}
                      className={cn(
                        'inline-flex size-4 items-center justify-center rounded-sm',
                        'bg-surface-raised text-muted-foreground hover:text-foreground',
                        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                      )}
                      onClick={() => {
                        const hovered = getHoveredLine();
                        if (!hovered) return;
                        onLineComment({
                          path: file.path,
                          line: hovered.lineNumber,
                          side: hovered.side === 'deletions' ? 'old' : 'new',
                        });
                      }}
                    >
                      <MessageSquarePlus strokeWidth={1.75} className="size-3" />
                    </button>
                  )
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
