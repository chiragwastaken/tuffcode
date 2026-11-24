import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
// oxlint-disable-next-line import/no-unassigned-import -- xterm ships its own stylesheet
import '@xterm/xterm/css/xterm.css';
import { cn } from './cn';

export interface TerminalHandle {
  /** Write raw terminal data (output from the pty). */
  write(data: string): void;
  /** Recompute rows and columns from the container size. */
  fit(): void;
  focus(): void;
}

export interface TerminalProps {
  /** Fired with user keystrokes; forward to `terminal.input`. */
  onData?: (data: string) => void;
  /** Fired after a fit or a browser resize; forward to `terminal.resize`. */
  onResize?: (size: { cols: number; rows: number }) => void;
  autoFocus?: boolean;
  fontSize?: number;
  className?: string;
  ref?: Ref<TerminalHandle>;
}

function readVar(styles: CSSStyleDeclaration, name: string): string | undefined {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

/** Theme comes from the CSS variables in tokens.css, read once at mount. */
function readTheme(): ITheme {
  if (typeof document === 'undefined') return {};
  const styles = getComputedStyle(document.documentElement);
  const theme: ITheme = {};
  const background = readVar(styles, '--terminal-background');
  const foreground = readVar(styles, '--terminal-foreground');
  const cursor = readVar(styles, '--terminal-cursor');
  const selection = readVar(styles, '--terminal-selection');
  if (background) theme.background = background;
  if (foreground) theme.foreground = foreground;
  if (cursor) theme.cursor = cursor;
  if (selection) theme.selectionBackground = selection;
  return theme;
}

export function Terminal({
  onData,
  onResize,
  autoFocus = true,
  fontSize = 13,
  className,
  ref,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useImperativeHandle(
    ref,
    () => ({
      write: (data) => termRef.current?.write(data),
      fit: () => fitRef.current?.fit(),
      focus: () => termRef.current?.focus(),
    }),
    [],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const styles = getComputedStyle(document.documentElement);
    const term = new XTerm({
      cursorBlink: true,
      fontSize,
      fontFamily: readVar(styles, '--font-mono') ?? 'monospace',
      scrollback: 5000,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    try {
      fit.fit();
    } catch {
      // The container can be zero-sized on first paint; the observer refits.
    }

    const dataSubscription = term.onData((data) => onDataRef.current?.(data));
    const resizeSubscription = term.onResize((size) => onResizeRef.current?.(size));
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Ignore transient zero-size measurements during layout changes.
      }
    });
    observer.observe(element);

    termRef.current = term;
    fitRef.current = fit;
    if (autoFocus) term.focus();

    return () => {
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      // Ignore transient zero-size measurements during layout changes.
    }
  }, [fontSize]);

  return <div ref={containerRef} className={cn('size-full bg-terminal-background', className)} />;
}
