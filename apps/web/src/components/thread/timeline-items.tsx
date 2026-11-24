import { Markdown, Spinner, cn, focusRing, type MarkdownTheme } from '@tuffcode/ui';
import {
  Brain,
  Check,
  ChevronRight,
  Copy,
  FilePenLine,
  Info,
  Pencil,
  RotateCcw,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { type NoticeItem, type ToolItem, type UserItem } from './grouping';
import {
  blockCopyText,
  elapsedMs,
  formatDuration,
  outputTail,
  toolDetail,
  toolDiffLines,
  toolHeadline,
  toolTarget,
  toolVerb,
  type FinalBlock,
  type ProseBlock,
  type ReasoningBlock,
  type ToolDiffLine,
  type ToolGroupBlock,
} from './turn-blocks';

function StreamingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-1.5 animate-[pulse_1.2s_steps(2,end)_infinite] bg-foreground/70 align-text-bottom"
    />
  );
}

export function UserBubble({
  item,
  onRetry,
}: {
  item: UserItem;
  onRetry?: (item: UserItem) => void;
}) {
  const failed = item.status === 'failed';
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        <div
          data-testid={failed ? 'user-message-failed' : 'user-message'}
          data-status={item.status}
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-foreground',
            failed ? 'bg-error-surface/60' : 'bg-message-surface',
            item.status === 'pending' && 'opacity-70',
          )}
        >
          {item.text}
          {item.attachments.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.attachments.map((attachment, index) => (
                <span
                  key={`${attachment.path}-${index}`}
                  className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                  title={attachment.path}
                >
                  {attachment.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {failed ? (
          <span className="flex items-center gap-1.5 text-2xs text-error-foreground">
            <span>Not sent.</span>
            <button
              type="button"
              data-testid="user-message-retry"
              onClick={() => onRetry?.(item)}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium hover:bg-accent',
                focusRing,
              )}
            >
              <RotateCcw aria-hidden="true" strokeWidth={1.75} className="size-3" />
              Retry
            </button>
          </span>
        ) : item.status === 'pending' ? (
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Spinner size="sm" label="Sending" />
            Sending
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Context the model wrote before reaching for a tool: smaller and narrower. */
export function ProseText({ block, theme }: { block: ProseBlock; theme: MarkdownTheme }) {
  return (
    <div
      data-testid="assistant-prose"
      className="max-w-[72ch] px-1 text-[13.5px] leading-[1.65] text-foreground [&_p]:my-2 [&_p]:leading-[1.65] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
    >
      <Markdown content={block.text} theme={theme} />
      {block.streaming ? <StreamingCaret /> : null}
    </div>
  );
}

export interface FinalAnswerProps {
  block: FinalBlock;
  theme: MarkdownTheme;
  onRetry?: (item: UserItem) => void;
  onEdit?: (item: UserItem, text: string) => void;
}

/** The closing answer, with copy, retry and edit actions on hover. */
export function FinalAnswer({ block, theme, onRetry, onEdit }: FinalAnswerProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const prompt = block.prompt;
  const showActions = prompt !== null && !block.streaming && block.text.trim().length > 0;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(blockCopyText(block));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied in hardened environments.
    }
  }

  function startEditing(): void {
    if (prompt === null) return;
    setDraft(prompt.text);
    setEditing(true);
  }

  function submitEdit(): void {
    if (prompt === null) return;
    const text = draft.trim();
    if (text.length === 0) return;
    setEditing(false);
    onEdit?.(prompt, text);
  }

  return (
    <div className="group/final flex flex-col gap-1">
      <div
        data-testid="assistant-message"
        className="max-w-[var(--chat-content-max-width)] px-1 text-sm leading-6 text-foreground"
      >
        <Markdown content={block.text} theme={theme} />
        {block.streaming ? <StreamingCaret /> : null}
      </div>

      {editing && prompt ? (
        <div className="rounded-lg border border-border bg-surface-raised/60 p-2">
          <textarea
            data-testid="final-edit-input"
            aria-label="Edit the prompt"
            value={draft}
            autoFocus
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitEdit();
              }
            }}
            className={cn(
              'w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm leading-6 text-foreground',
              focusRing,
            )}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={cn(
                'inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                focusRing,
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="final-edit-submit"
              disabled={draft.trim().length === 0}
              onClick={submitEdit}
              className={cn(
                'inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
                focusRing,
              )}
            >
              Save and resend
            </button>
          </div>
        </div>
      ) : null}

      {showActions && !editing ? (
        <div
          data-testid="final-actions"
          className="flex items-center gap-1 px-1 opacity-0 transition-opacity duration-150 group-focus-within/final:opacity-100 group-hover/final:opacity-100"
        >
          <button
            type="button"
            data-testid="final-copy"
            data-copied={copied ? 'true' : 'false'}
            aria-label="Copy answer"
            title="Copy answer"
            onClick={() => void copy()}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              focusRing,
            )}
          >
            {copied ? (
              <Check aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            ) : (
              <Copy aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            data-testid="final-retry"
            aria-label="Retry the prompt"
            title="Retry"
            onClick={() => onRetry?.(prompt)}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              focusRing,
            )}
          >
            <RotateCcw aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </button>
          <button
            type="button"
            data-testid="final-edit"
            aria-label="Edit the prompt"
            title="Edit"
            onClick={startEditing}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              focusRing,
            )}
          >
            <Pencil aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReasoningRow({ block }: { block: ReasoningBlock }) {
  const [open, setOpen] = useState(false);
  const duration = formatDuration(block.durationMs);
  const label = block.streaming ? 'Thinking' : duration.length > 0 ? `Thought for ${duration}` : 'Thought';

  return (
    <div data-testid="reasoning-block" className="rounded-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent',
          focusRing,
        )}
      >
        <Brain aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium">{label}</span>
        {block.streaming ? <Spinner size="sm" label="Thinking" /> : null}
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'ml-auto size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <pre className="mt-0.5 max-h-64 overflow-auto border-l border-border/60 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
          {block.text}
        </pre>
      ) : null}
    </div>
  );
}

function ToolStatusIcon({ tool }: { tool: ToolItem }) {
  if (tool.running) return <Spinner size="sm" label="Tool running" />;
  if (tool.isError) {
    return (
      <X aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0 text-error-foreground" />
    );
  }
  return (
    <Check
      aria-hidden="true"
      strokeWidth={1.75}
      className="size-3.5 shrink-0 text-success-foreground"
    />
  );
}

function toolIcon(name: string): LucideIcon {
  const detail = toolDetail(name);
  if (detail === 'diff') return FilePenLine;
  if (detail === 'matches') return Search;
  if (toolVerb(name) === 'Ran') return Terminal;
  return Wrench;
}

function DiffBody({ lines, path }: { lines: ToolDiffLine[]; path: string }) {
  const shown = lines.slice(0, 40);
  const hidden = lines.length - shown.length;

  return (
    <div className="border-t border-border/60 px-3 py-2">
      {path.length > 0 ? (
        <p className="mb-1 font-mono text-2xs text-muted-foreground">{path}</p>
      ) : null}
      <div
        data-testid="tool-diff"
        className="max-h-64 overflow-auto rounded-sm bg-background/60 py-1 font-mono text-2xs leading-5"
      >
        {shown.map((line, index) => (
          <div
            key={index}
            className={cn(
              'px-2 whitespace-pre-wrap',
              line.kind === 'add'
                ? 'bg-success/10 text-success-foreground'
                : line.kind === 'remove'
                  ? 'bg-error/10 text-error-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
            {line.text}
          </div>
        ))}
        {hidden > 0 ? (
          <div className="px-2 text-muted-foreground">{hidden} more lines</div>
        ) : null}
      </div>
    </div>
  );
}

function CopyOutputButton({ tool }: { tool: ToolItem }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(tool.output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied in hardened environments.
    }
  }

  return (
    <button
      type="button"
      aria-label="Copy output"
      title="Copy output"
      onClick={() => void copy()}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground',
        focusRing,
      )}
    >
      {copied ? (
        <Check aria-hidden="true" strokeWidth={1.75} className="size-3" />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.75} className="size-3" />
      )}
    </button>
  );
}

function ToolBody({ tool }: { tool: ToolItem }) {
  const detail = toolDetail(tool.name);

  if (detail === 'diff') {
    const lines = toolDiffLines(tool.input);
    if (lines.length > 0) return <DiffBody lines={lines} path={toolTarget(tool.input)} />;
  }

  if (detail === 'matches') {
    const matches = outputTail(tool.output, 30);
    return (
      <div className="border-t border-border/60 px-3 py-2">
        <pre
          data-testid="tool-matches"
          className={cn(
            'max-h-64 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap',
            tool.isError ? 'text-error-foreground' : 'text-muted-foreground',
          )}
        >
          {matches.lines.join('\n') || (tool.running ? 'Searching' : 'No matches')}
        </pre>
      </div>
    );
  }

  const tail = outputTail(tool.output);
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs tracking-wide text-muted-foreground uppercase">
          {tail.hidden > 0 ? `Output, last ${tail.lines.length} of ${tail.hidden + tail.lines.length} lines` : 'Output'}
        </p>
        <CopyOutputButton tool={tool} />
      </div>
      <pre
        data-testid="tool-output"
        className={cn(
          'mt-1 max-h-64 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap',
          tool.isError ? 'text-error-foreground' : 'text-muted-foreground',
        )}
      >
        {tail.lines.join('\n') || (tool.running ? 'Running' : 'No output')}
      </pre>
    </div>
  );
}

/** One 32px tool row: status, icon, verb, target, duration, and expandable body. */
export function ToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(tool.name);
  const target = toolTarget(tool.input);
  const duration = formatDuration(elapsedMs(tool.startedAt, tool.finishedAt));

  return (
    <div
      data-testid="tool-row"
      data-status={tool.running ? 'running' : tool.isError ? 'error' : 'done'}
      className={cn('rounded-md', tool.isError && 'bg-error-surface/40')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={toolHeadline(tool.name, tool.input)}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent',
          focusRing,
        )}
      >
        <ToolStatusIcon tool={tool} />
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            'shrink-0 text-xs font-medium',
            tool.isError ? 'text-error-foreground' : 'text-foreground',
          )}
        >
          {toolVerb(tool.name)}
        </span>
        {target.length > 0 ? (
          <span
            className={cn(
              'truncate font-mono text-xs',
              tool.isError ? 'text-error-foreground' : 'text-muted-foreground',
            )}
            title={target}
          >
            {target}
          </span>
        ) : null}
        {duration.length > 0 ? (
          <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/70">
            {duration}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            duration.length > 0 ? '' : 'ml-auto',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? <ToolBody tool={tool} /> : null}
    </div>
  );
}

/** Consecutive tool calls on one rounded surface; two or more fold under a count. */
export function ToolGroup({ block }: { block: ToolGroupBlock }) {
  const [open, setOpen] = useState(false);
  const [first] = block.tools;
  if (first === undefined) return null;
  if (block.tools.length === 1) return <ToolRow tool={first} />;

  const running = block.tools.some((tool) => tool.running);
  const failed = block.tools.some((tool) => tool.isError);
  const duration = formatDuration(block.durationMs);
  const names = block.tools.map((tool) => tool.name).join(', ');

  return (
    <div
      data-testid="tool-group"
      className="overflow-hidden rounded-lg border border-border/60 bg-surface-raised/40"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-accent',
          focusRing,
        )}
      >
        {running ? (
          <Spinner size="sm" label="Tools running" />
        ) : failed ? (
          <X
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5 shrink-0 text-error-foreground"
          />
        ) : (
          <Check
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5 shrink-0 text-success-foreground"
          />
        )}
        <Wrench
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 text-xs font-medium text-foreground">
          Ran {block.tools.length} tools
        </span>
        <span className="truncate text-xs text-muted-foreground">{names}</span>
        {duration.length > 0 ? (
          <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/70">
            {duration}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            duration.length > 0 ? '' : 'ml-auto',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-border/60 p-1.5">
          {block.tools.map((tool) => (
            <ToolRow key={tool.key} tool={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function NoticeRow({ item }: { item: NoticeItem }) {
  const Icon = item.tone === 'error' ? TriangleAlert : Info;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-5',
        item.tone === 'error'
          ? 'border-error/40 bg-error-surface text-error-foreground'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{item.text}</span>
    </div>
  );
}
