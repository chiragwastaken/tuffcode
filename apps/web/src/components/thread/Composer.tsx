import type {
  Attachment,
  Command,
  ExecutionMode,
  Model,
  PermissionMode,
  Skill,
  Thread,
} from '@tuffcode/contracts';
import {
  Button,
  IconButton,
  Kbd,
  Select,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@tuffcode/ui';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { attachmentFromFile, attachmentFromFolder, hasFilePathBridge } from './attachments';
import {
  addLocalUserMessage,
  failLocalUserMessage,
  resolveLocalUserMessage,
} from './local-messages';
import { filterPalette, parseTrigger, triggerInsert, type PaletteKind } from './slash';
import { useProjectPalette } from './use-project-palette';

const MODE_OPTIONS: { value: ExecutionMode; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'work', label: 'Work' },
  { value: 'council', label: 'Council' },
];

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'read-only', label: 'Read only' },
  { value: 'ask', label: 'Ask' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'full-auto', label: 'Full auto' },
];

const MAX_TEXTAREA_HEIGHT = 200;

let localMessageSeq = 0;

function nextLocalMessageId(threadId: string): string {
  localMessageSeq += 1;
  return `${threadId}-${Date.now().toString(36)}-${localMessageSeq.toString(36)}`;
}

export interface ComposerProps {
  thread: Thread | undefined;
}

export function Composer({ thread }: ComposerProps) {
  const rpc = useRpc();
  const connection = useAppStore((state) => state.connection);
  const upsertThread = useAppStore((state) => state.upsertThread);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fileBridge] = useState(hasFilePathBridge);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const providerId = thread?.providerId;
  const modelId = thread?.modelId;

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    rpc.request('models.list', { providerId }).then(
      (list) => {
        if (!cancelled) setModels(list);
      },
      () => {
        if (!cancelled) setModels([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [providerId, rpc]);

  const trigger = parseTrigger(input);
  const triggerKind = trigger?.kind ?? null;
  const triggerQuery = trigger?.query ?? '';
  const palette = useProjectPalette(thread?.projectId, triggerKind !== null);

  const paletteEntries = useMemo(() => {
    if (!triggerKind) return [];
    const source = triggerKind === 'command' ? palette.commands : palette.skills;
    return filterPalette(source, triggerQuery);
  }, [palette.commands, palette.skills, triggerKind, triggerQuery]);

  const paletteOpen =
    triggerKind !== null && dismissed !== input && paletteEntries.length > 0 && !sending;
  const activeEntry = paletteEntries[Math.min(activeIndex, paletteEntries.length - 1)];

  useEffect(() => {
    setActiveIndex(0);
  }, [triggerKind, triggerQuery]);

  useEffect(() => {
    if (!paletteOpen) return;
    const element = paletteRef.current?.querySelector('[data-active="true"]');
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, paletteOpen]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const modelOptions = useMemo(() => {
    const options = models.map((model) => ({ value: model.modelId, label: model.label }));
    if (modelId && !options.some((option) => option.value === modelId)) {
      options.unshift({ value: modelId, label: modelId });
    }
    return options;
  }, [modelId, models]);

  const running = thread?.status === 'running';
  const canSend =
    thread !== undefined && connection === 'open' && !sending && input.trim().length > 0;

  async function applyUpdate(
    patch: Partial<Pick<Thread, 'modelId' | 'executionMode' | 'permissionMode'>>,
  ): Promise<void> {
    if (!thread) return;
    setUpdating(true);
    try {
      const updated = await rpc.request('threads.update', { id: thread.id, ...patch });
      upsertThread(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the thread.');
    } finally {
      setUpdating(false);
    }
  }

  async function send(): Promise<void> {
    if (!thread || !canSend) return;
    const text = input.trim();
    if (text.length === 0) return;
    const messageId = nextLocalMessageId(thread.id);
    addLocalUserMessage({
      id: messageId,
      threadId: thread.id,
      turnId: null,
      text,
      attachments,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setSending(true);
    setInput('');
    setAttachments([]);
    try {
      const result = await rpc.request('threads.send', {
        id: thread.id,
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      resolveLocalUserMessage(messageId, result.turnId);
    } catch (error) {
      failLocalUserMessage(messageId);
      toast.error(error instanceof Error ? error.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  }

  async function stop(): Promise<void> {
    if (!thread || stopping) return;
    setStopping(true);
    try {
      await rpc.request('threads.interrupt', { id: thread.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop the turn.');
    } finally {
      setStopping(false);
    }
  }

  function choose(entry: Command | Skill): void {
    if (!triggerKind) return;
    const next = triggerInsert(triggerKind, entry.name);
    setInput(next);
    setDismissed(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.length, next.length);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return;

    if (paletteOpen && paletteEntries.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % paletteEntries.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + paletteEntries.length) % paletteEntries.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        if (activeEntry) choose(activeEntry);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(input);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  async function attach(): Promise<void> {
    if (fileBridge) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await window.tuffcode.pickFolder();
      if (!path) return;
      setAttachments((current) => [...current, attachmentFromFolder(path)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the folder picker.');
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const added: Attachment[] = [];
    for (const file of files) {
      const attachment = attachmentFromFile(file);
      if (attachment) added.push(attachment);
    }
    if (added.length < files.length) {
      toast.error('Some files have no filesystem path in this build.');
    }
    if (added.length > 0) setAttachments((current) => [...current, ...added]);
  }

  const paletteLabel: Record<PaletteKind, string> = {
    command: 'Commands',
    skill: 'Skills',
  };

  return (
    <div className="shrink-0 border-t border-border px-3 py-3">
      <div className="relative mx-auto w-full max-w-[var(--chat-content-max-width)]">
        {paletteOpen && triggerKind ? (
          <div
            ref={paletteRef}
            data-testid="command-palette"
            className="absolute bottom-full left-0 z-30 mb-2 flex max-h-80 w-full flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
              <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                {paletteLabel[triggerKind]}
              </span>
              <span className="text-2xs text-muted-foreground">
                {paletteEntries.length} {paletteEntries.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
            <div className="relative min-h-0">
              <ul className="max-h-64 overflow-y-auto p-1" aria-label={paletteLabel[triggerKind]}>
                {paletteEntries.map((entry, index) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      data-active={index === activeIndex}
                      aria-current={index === activeIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(entry)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left',
                        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                        index === activeIndex
                          ? 'bg-foreground/[0.08] ring-1 ring-border/60 ring-inset'
                          : 'hover:bg-accent',
                      )}
                    >
                      <span className="font-mono text-xs text-foreground">
                        {triggerKind === 'command' ? '/' : '$'}
                        {entry.name}
                      </span>
                      <span className="line-clamp-1 text-2xs text-muted-foreground">
                        {entry.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-popover to-transparent"
              />
            </div>
            <div className="flex items-center gap-3 border-t border-border px-2.5 py-1.5 text-2xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4">↑</Kbd>
                <Kbd className="h-4 min-w-4">↓</Kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4">↵</Kbd>
                insert
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4">esc</Kbd>
                close
              </span>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-message-surface/80 p-3 backdrop-blur-md transition-colors duration-150 focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/40 focus-within:ring-inset">
          {attachments.length > 0 ? (
            <div className="mb-1 flex flex-wrap gap-1.5 px-1">
              {attachments.map((attachment, index) => (
                <span
                  key={`${attachment.path}-${index}`}
                  className="inline-flex max-w-60 items-center gap-1 rounded-sm border border-border bg-background/40 px-1.5 py-0.5 text-2xs text-muted-foreground"
                  title={attachment.path}
                >
                  <Paperclip aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((entry) => entry.path !== attachment.path),
                      )
                    }
                  >
                    <X aria-hidden="true" strokeWidth={1.75} className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            data-testid="composer-input"
            rows={1}
            value={input}
            aria-label="Message"
            placeholder={
              thread
                ? 'Ask for a change. Enter sends, Shift+Enter adds a line.'
                : 'Select a thread to start.'
            }
            disabled={!thread}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-64"
          />

          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    icon={Paperclip}
                    label={fileBridge ? 'Attach files' : 'Attach folder'}
                    size="sm"
                    disabled={!thread || sending}
                    onClick={() => void attach()}
                  />
                }
              />
              <TooltipContent>{fileBridge ? 'Attach files' : 'Attach a folder'}</TooltipContent>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFiles}
            />

            <Select
              aria-label="Model"
              value={modelId ?? null}
              options={modelOptions}
              placeholder="Model"
              disabled={!thread || updating || modelOptions.length === 0}
              onValueChange={(value) => {
                if (value && value !== modelId) void applyUpdate({ modelId: value });
              }}
              className="h-7 w-auto min-w-28 max-w-52 rounded-md border-border/60 bg-secondary px-2 text-2xs hover:bg-accent"
            />
            <Select
              aria-label="Execution mode"
              value={thread?.executionMode ?? null}
              options={MODE_OPTIONS}
              disabled={!thread || updating}
              onValueChange={(value) => {
                const next = MODE_OPTIONS.find((option) => option.value === value);
                if (next && next.value !== thread?.executionMode) {
                  void applyUpdate({ executionMode: next.value });
                }
              }}
              className="h-7 w-auto min-w-20 rounded-md border-border/60 bg-secondary px-2 text-2xs hover:bg-accent"
            />
            <Select
              aria-label="Permission mode"
              value={thread?.permissionMode ?? null}
              options={PERMISSION_OPTIONS}
              disabled={!thread || updating}
              onValueChange={(value) => {
                const next = PERMISSION_OPTIONS.find((option) => option.value === value);
                if (next && next.value !== thread?.permissionMode) {
                  void applyUpdate({ permissionMode: next.value });
                }
              }}
              className="h-7 w-auto min-w-24 rounded-md border-border/60 bg-secondary px-2 text-2xs hover:bg-accent"
            />

            <div className="ml-auto flex items-center gap-2">
              {running ? (
                <Button size="sm" variant="outline" disabled={stopping} onClick={() => void stop()}>
                  {stopping ? (
                    <Spinner size="sm" label="Stopping" />
                  ) : (
                    <Square strokeWidth={1.75} />
                  )}
                  Stop
                </Button>
              ) : (
                <Button
                  data-testid="composer-send"
                  size="sm"
                  variant="primary"
                  disabled={!canSend}
                  onClick={() => void send()}
                >
                  {sending ? <Spinner size="sm" label="Sending" /> : <ArrowUp strokeWidth={1.75} />}
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
