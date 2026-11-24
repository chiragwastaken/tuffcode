import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  Spinner,
  cn,
} from '@tuffcode/ui';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import {
  SAMPLE_PREVIEW_MESSAGE,
  orderPromptSections,
  previewExcerpt,
  previewSectionPercent,
  promptSectionBarClass,
  promptSectionLabel,
  type PreviewSection,
} from './custom-prompt';
import { InlineAlert } from './inline-alert';

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; sections: PreviewSection[]; total: number }
  | { status: 'error'; message: string };

export interface PromptPreviewPanelProps {
  /** True while the draft is over the 300-token cap the server enforces. */
  overBudget?: boolean;
}

/**
 * The assembled prompt for one sample message, straight from `prompt.preview`.
 * It refreshes when the saved instructions change, so the panel always reflects
 * what the next turn will receive rather than what is typed in the box.
 */
export function PromptPreviewPanel({ overBudget }: PromptPreviewPanelProps) {
  const rpc = useRpc();
  const threads = useAppStore((state) => state.threads);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const customInstructions = useAppStore((state) => state.settings?.customInstructions ?? '');
  const threadId = activeThreadId ?? Object.keys(threads)[0] ?? null;

  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (threadId === null) return;
    let cancelled = false;
    setState({ status: 'loading' });
    rpc
      .request('prompt.preview', { threadId, message: SAMPLE_PREVIEW_MESSAGE })
      .then((result) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          sections: orderPromptSections(result.sections),
          total: result.total,
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: caught instanceof Error ? caught.message : 'Could not build the preview.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, customInstructions, nonce]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Prompt preview</CardTitle>
          <CardDescription>
            What a turn sends for a sample message, section by section. It refreshes after a save so
            the preview always matches the stored instructions.
          </CardDescription>
        </div>
        <IconButton
          icon={RefreshCw}
          label="Refresh prompt preview"
          size="sm"
          onClick={() => setNonce((value) => value + 1)}
          disabled={threadId === null || state.status === 'loading'}
          className={state.status === 'loading' ? '[&_svg]:animate-spin' : undefined}
        />
      </CardHeader>

      <div className="border-t border-border px-4 py-3">
        {overBudget ? (
          <InlineAlert tone="info" className="mb-3">
            The draft is over the 300-token budget. The injected block is cut at a sentence
            boundary, so the preview shows the truncated text.
          </InlineAlert>
        ) : null}

        {threadId === null ? (
          <EmptyState
            title="Open a thread to preview"
            description="The preview runs the same planner as a real turn, and a turn needs a thread."
          />
        ) : null}

        {threadId !== null && state.status === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="sm" label="Building prompt preview" />
            Building preview...
          </div>
        ) : null}

        {state.status === 'error' ? <InlineAlert>{state.message}</InlineAlert> : null}

        {state.status === 'ready' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
                <span>{state.sections.length} sections</span>
                <span data-testid="prompt-preview-total">{state.total} tokens total</span>
              </div>
              <div
                role="img"
                aria-label={`Prompt total: ${state.total} tokens`}
                className="flex h-1.5 w-full overflow-hidden rounded-full bg-border"
              >
                {state.sections.map((section) => (
                  <div
                    key={section.name}
                    className={cn('h-full', promptSectionBarClass(section.name))}
                    style={{ width: `${previewSectionPercent(section.tokens, state.total)}%` }}
                  />
                ))}
              </div>
            </div>

            <ul className="divide-y divide-border">
              {state.sections.map((section) => (
                <li
                  key={section.name}
                  data-testid={`prompt-section-${section.name}`}
                  className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          promptSectionBarClass(section.name),
                        )}
                      />
                      <span className="truncate">{promptSectionLabel(section.name)}</span>
                    </span>
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {section.tokens} tokens
                    </span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {previewExcerpt(section.text)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
