import { Markdown, Spinner, cn, focusRing, type MarkdownTheme } from '@tuffcode/ui';
import { Check, ChevronRight, Info, TriangleAlert, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import {
  formatToolInput,
  toolSummary,
  type AssistantItem,
  type NoticeItem,
  type ReasoningItem,
  type ToolItem,
  type UserItem,
} from './grouping';

export function UserBubble({ item }: { item: UserItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-message-surface px-3.5 py-2 text-sm leading-6 whitespace-pre-wrap break-words text-foreground">
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
    <div className="text-sm text-foreground">
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
    <div className="rounded-md border border-border/70">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent',
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
        <span className="text-2xs font-medium text-muted-foreground">Thinking</span>
        {item.streaming ? <Spinner size="sm" label="Thinking" /> : null}
        {open ? null : (
          <span className="truncate text-2xs text-muted-foreground/70">
            {item.text.replace(/\s+/g, ' ').trim().slice(0, 100)}
          </span>
        )}
      </button>
      {open ? (
        <p className="border-t border-border/70 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
          {item.text}
        </p>
      ) : null}
    </div>
  );
}

export function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(item.input);
  const output = item.output;

  return (
    <div
      className={cn(
        'rounded-md border bg-surface-raised/40',
        item.isError ? 'border-error/40' : 'border-border/70',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent',
          focusRing,
        )}
      >
        {item.running ? (
          <Spinner size="sm" label="Tool running" />
        ) : item.isError ? (
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
        <span className="shrink-0 font-mono text-2xs text-foreground">{item.name}</span>
        {summary ? (
          <span className="truncate text-2xs text-muted-foreground">{summary}</span>
        ) : null}
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
        <div className="flex flex-col gap-2 border-t border-border/70 px-2.5 py-2">
          <div>
            <p className="text-2xs tracking-wide text-muted-foreground uppercase">Input</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap text-muted-foreground">
              {formatToolInput(item.input) || 'No input'}
            </pre>
          </div>
          <div>
            <p className="text-2xs tracking-wide text-muted-foreground uppercase">Output</p>
            <pre
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
