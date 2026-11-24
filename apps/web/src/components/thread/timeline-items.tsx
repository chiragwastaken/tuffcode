import { Markdown, Spinner, cn, focusRing, type MarkdownTheme } from '@tuffcode/ui';
import { Check, ChevronRight, Copy, Info, TriangleAlert, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import {
  formatToolInput,
  toolGroupSummary,
  toolSummary,
  type AssistantItem,
  type NoticeItem,
  type ReasoningItem,
  type ToolGroupItem,
  type ToolItem,
  type UserItem,
} from './grouping';

export function UserBubble({ item }: { item: UserItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-message-surface px-3.5 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-foreground">
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
    </div>
  );
}

export function AssistantMessage({ item, theme }: { item: AssistantItem; theme: MarkdownTheme }) {
  return (
    <div
      data-testid="assistant-message"
      className="max-w-[var(--chat-content-max-width)] px-1 text-sm leading-6 text-foreground"
    >
      <Markdown content={item.text} theme={theme} />
      {item.streaming ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-4 w-1.5 animate-[pulse_1.2s_steps(2,end)_infinite] bg-foreground/70 align-text-bottom"
        />
      ) : null}
    </div>
  );
}

export function ReasoningRow({ item }: { item: ReasoningItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md bg-surface-raised/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left hover:bg-accent',
          focusRing,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Thinking</span>
        {item.streaming ? <Spinner size="sm" label="Thinking" /> : null}
        {open ? null : (
          <span className="truncate text-xs text-muted-foreground/70">
            {item.text.replace(/\s+/g, ' ').trim().slice(0, 100)}
          </span>
        )}
      </button>
      {open ? (
        <p className="border-t border-border/60 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
          {item.text}
        </p>
      ) : null}
    </div>
  );
}

function ToolStatusIcon({ item }: { item: ToolItem }) {
  if (item.running) return <Spinner size="sm" label="Tool running" />;
  if (item.isError) {
    return (
      <X
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-error-foreground"
      />
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

export function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const summary = toolSummary(item.input);
  const output = item.output;

  async function copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied in hardened environments.
    }
  }

  return (
    <div
      data-testid="tool-row"
      className={cn(
        'rounded-md transition-colors duration-150',
        item.isError ? 'bg-error-surface/60' : 'bg-surface-raised/50',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left hover:bg-accent',
          focusRing,
        )}
      >
        <ToolStatusIcon item={item} />
        <Wrench
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 font-mono text-xs text-foreground">{item.name}</span>
        {summary ? <span className="truncate text-xs text-muted-foreground">{summary}</span> : null}
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2">
          <div>
            <p className="text-2xs tracking-wide text-muted-foreground uppercase">Input</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap text-muted-foreground">
              {formatToolInput(item.input) || 'No input'}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-2xs tracking-wide text-muted-foreground uppercase">Output</p>
              <button
                type="button"
                aria-label="Copy output"
                title="Copy output"
                onClick={() => void copyOutput()}
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
            </div>
            <pre
              data-testid="tool-output"
              className={cn(
                'mt-1 max-h-64 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap',
                item.isError ? 'text-error-foreground' : 'text-muted-foreground',
              )}
            >
              {output || (item.running ? 'Running' : 'No output')}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ToolGroupRow({ item }: { item: ToolGroupItem }) {
  const [open, setOpen] = useState(false);
  const running = item.tools.some((tool) => tool.running);
  const failed = item.tools.some((tool) => tool.isError);
  const names = item.tools.map((tool) => tool.name).join(', ');

  return (
    <div data-testid="tool-group" className="rounded-md bg-surface-raised/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left hover:bg-accent',
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
          {toolGroupSummary(item.tools.length)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{names}</span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-1 border-t border-border/60 p-1.5">
          {item.tools.map((tool) => (
            <ToolRow key={tool.key} item={tool} />
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
