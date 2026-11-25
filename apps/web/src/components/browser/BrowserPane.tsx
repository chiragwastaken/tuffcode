import { EmptyState, IconButton, Input } from '@tuffcode/ui';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent } from 'react';

/**
 * A lightweight browser tab for previews and docs: an http(s) URL in a sandboxed
 * iframe (no popups, no top navigation), with back, forward, reload and open
 * externally. Sites that refuse to be framed render blank; the external button is the
 * way out, and the hint below the bar says so instead of pretending.
 */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // `localhost:5173` would parse as a scheme, so local hosts are recognized first.
  const candidate = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)
    ? `http://${trimmed}`
    : /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface BrowserPaneProps {
  initialUrl?: string;
}

export function BrowserPane({ initialUrl }: BrowserPaneProps) {
  const [history, setHistory] = useState<string[]>(() =>
    initialUrl === undefined ? [] : [initialUrl],
  );
  const [index, setIndex] = useState(initialUrl === undefined ? -1 : 0);
  const [draft, setDraft] = useState(initialUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const current = index >= 0 ? (history[index] ?? null) : null;

  const navigate = useCallback(
    (raw: string) => {
      const url = normalizeBrowserUrl(raw);
      if (url === null) {
        setError('Enter an http or https address.');
        return;
      }
      setError(null);
      setDraft(url);
      setHistory((entries) => [...entries.slice(0, index + 1), url]);
      setIndex((value) => value + 1);
    },
    [index],
  );

  function submit(event: FormEvent): void {
    event.preventDefault();
    navigate(draft);
  }

  function step(delta: number): void {
    const next = index + delta;
    const url = history[next];
    if (url === undefined) return;
    setIndex(next);
    setDraft(url);
  }

  return (
    <div data-testid="browser-pane" className="flex h-full min-h-0 flex-col">
      <form onSubmit={submit} className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <IconButton icon={ArrowLeft} label="Back" size="sm" disabled={index <= 0} onClick={() => step(-1)} />
        <IconButton
          icon={ArrowRight}
          label="Forward"
          size="sm"
          disabled={index >= history.length - 1}
          onClick={() => step(1)}
        />
        <IconButton
          icon={RotateCw}
          label="Reload"
          size="sm"
          disabled={current === null}
          onClick={() => setReloadKey((value) => value + 1)}
        />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a URL"
          aria-label="Address"
          spellCheck={false}
          className="h-7 flex-1 text-xs"
          data-testid="browser-address"
        />
        <IconButton
          icon={ExternalLink}
          label="Open in your browser"
          size="sm"
          disabled={current === null || window.tuffcode?.openExternal === undefined}
          onClick={() => {
            if (current !== null) window.tuffcode?.openExternal?.(current);
          }}
        />
      </form>
      {error !== null ? <p className="px-3 py-1 text-2xs text-error-foreground">{error}</p> : null}
      {current === null ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={Globe} title="Browse the web" description="Type a URL to open a site. Local dev servers work too." />
        </div>
      ) : (
        <>
          <iframe
            key={`${current}#${reloadKey}`}
            ref={frameRef}
            src={current}
            title="Browser"
            data-testid="browser-frame"
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
          <p className="shrink-0 border-t border-border px-3 py-1 text-2xs text-muted-foreground">
            A blank page usually means the site does not allow embedding. Open it in your browser instead.
          </p>
        </>
      )}
    </div>
  );
}
