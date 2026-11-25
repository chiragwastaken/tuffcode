import type { PromptPreview } from '@tuffcode/contracts';
import { EmptyState, ScrollArea, Spinner } from '@tuffcode/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { injectionRows } from './context-model';
import { takeContextPreview, subscribePanelRequests } from './panel-requests';

/** What `/context` shows: the sections the next turn would send and their budget. */
export interface ContextPanelProps {
  threadId: string;
}

function lastUserText(messages: readonly { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.content;
  }
  return '';
}

/**
 * Renders `prompt.preview` for the thread's latest user message. `/context` hands the
 * preview in through the request slot, so opening it from the composer costs no
 * second round trip; opening the tab by hand fetches it here.
 */
export function ContextPanel({ threadId }: ContextPanelProps) {
  const rpc = useRpc();
  const messages = useAppStore((state) => state.messages[threadId]);
  const [preview, setPreview] = useState<PromptPreview | null>(() => takeContextPreview());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const previousThread = useRef(threadId);

  useEffect(() => {
    if (previousThread.current === threadId) return;
    previousThread.current = threadId;
    setPreview(takeContextPreview());
    setError(null);
  }, [threadId]);

  useEffect(
    () =>
      subscribePanelRequests(() => {
        const next = takeContextPreview();
        if (next === null) return;
        setPreview(next);
        setError(null);
      }),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const message = lastUserText(messages ?? []);
      const next = await rpc.request('prompt.preview', { threadId, message });
      setPreview(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build the prompt preview.');
    } finally {
      setLoading(false);
    }
  }, [messages, rpc, threadId]);

  useEffect(() => {
    if (preview !== null) return;
    void load();
  }, [load, preview]);

  if (error !== null) {
    return (
      <div className="p-3">
        <EmptyState variant="inline" title="Prompt preview unavailable" description={error} />
      </div>
    );
  }

  if (preview === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="sm" label="Loading the prompt budget" />
      </div>
    );
  }

  const injection = preview.injectedIds === undefined ? null : injectionRows(preview);

  return (
    <ScrollArea className="h-full min-h-0">
      <div data-testid="context-panel" className="flex flex-col gap-3 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-medium text-foreground">Prompt budget</h2>
          <span data-testid="context-total" className="text-2xs text-muted-foreground">
            {preview.total} tokens · {preview.sections.length} sections
          </span>
        </div>
        {preview.sections.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No prompt sections yet"
            description="Send a message, or run /context again once the thread has history."
          />
        ) : (
          <ul aria-label="Prompt sections" className="flex flex-col gap-2">
            {preview.sections.map((section) => (
              <li
                key={section.name}
                data-testid="context-section"
                className="rounded-md border border-border bg-card/40"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
                  <span className="font-mono text-2xs text-foreground">{section.name}</span>
                  <span className="text-2xs text-muted-foreground">{section.tokens} tokens</span>
                </div>
                <pre className="max-h-40 overflow-auto px-2.5 py-2 font-mono text-2xs leading-5 whitespace-pre-wrap break-words text-muted-foreground">
                  {section.text}
                </pre>
              </li>
            ))}
          </ul>
        )}
        {injection === null ? null : (
          <section
            aria-label="Brain injection"
            data-testid="context-injection"
            className="flex flex-col gap-1"
          >
            <h2 className="text-xs font-medium text-foreground">Brain injection</h2>
            <span data-testid="context-injection-count" className="text-2xs text-muted-foreground">
              {injection.count === 0
                ? 'No brain entries injected'
                : `${injection.count} ${injection.count === 1 ? 'entry' : 'entries'} injected`}
            </span>
            {injection.rows.length === 0 ? null : (
              <ul aria-label="Injected brain entries" className="flex flex-col gap-1">
                {injection.rows.map((row) => (
                  <li
                    key={row.id}
                    data-testid="context-injection-row"
                    className="flex min-w-0 items-baseline gap-2 text-2xs"
                  >
                    <span
                      title={row.id}
                      className="max-w-[50%] shrink-0 truncate font-mono text-foreground"
                    >
                      {row.id}
                    </span>
                    <span
                      title={row.reason}
                      className="min-w-0 flex-1 truncate text-muted-foreground"
                    >
                      {row.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="self-start rounded-sm text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-64"
        >
          Refresh preview
        </button>
      </div>
    </ScrollArea>
  );
}
