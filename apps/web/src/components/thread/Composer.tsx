import type {
  Attachment,
  Command,
  ExecutionMode,
  PermissionMode,
  Skill,
  Thread,
} from '@tuffcode/contracts';
import { useNavigate } from '@tanstack/react-router';
import {
  Button,
  IconButton,
  Kbd,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  buttonVariants,
  cn,
} from '@tuffcode/ui';
import { ArrowUp, Check, Paperclip, SlidersHorizontal, Square, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { CouncilGoal } from '../council/CouncilGoal';
import { CouncilStatusStrip } from '../council/CouncilStatusStrip';
import { councilSummary } from '../council/council-goal';
import { useCouncilGoal } from '../council/use-council-goal';
import { requestInspectorTab } from '../inspector/panel-requests';
import { ModelPicker } from '../models/ModelPicker';
import { attachmentFromFile, attachmentFromFolder, hasFilePathBridge } from './attachments';
import { dispatchCommandResult } from './command-run';
import { DEFAULT_CONTEXT_WARNING_THRESHOLD } from './context-meter';
import { ContextMeter } from './ContextMeter';
import {
  addLocalUserMessage,
  clearLocalUserMessages,
  failLocalUserMessage,
  nextLocalUserMessageId,
  resolveLocalUserMessage,
} from './local-messages';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import {
  filterPalette,
  parseTrigger,
  slashCommandName,
  triggerInsert,
  type PaletteKind,
} from './slash';
import { useProjectPalette } from './use-project-palette';

/** The composer's own mode control; Council is chosen in the topbar switch. */
type ComposerMode = Extract<ExecutionMode, 'work' | 'plan'>;

const MODE_OPTIONS: readonly SegmentedOption<ComposerMode>[] = [
  { value: 'work', label: 'Build' },
  { value: 'plan', label: 'Plan' },
];

const PERMISSION_LABEL: Record<PermissionMode, string> = {
  'read-only': 'Read only',
  ask: 'Ask',
  'accept-edits': 'Auto edits',
  'full-auto': 'Full auto',
};

/** The three everyday permission modes; read-only joins them only when it is set. */
const PERMISSION_SEGMENTS: readonly PermissionMode[] = ['ask', 'accept-edits', 'full-auto'];

const PERMISSION_MENU: readonly { value: PermissionMode; label: string }[] = [
  { value: 'read-only', label: PERMISSION_LABEL['read-only'] },
  { value: 'ask', label: PERMISSION_LABEL.ask },
  { value: 'accept-edits', label: PERMISSION_LABEL['accept-edits'] },
  { value: 'full-auto', label: PERMISSION_LABEL['full-auto'] },
];

/** Below this the permission control becomes a menu button instead of shrinking. */
const COMPACT_WIDTH = 720;

const MAX_TEXTAREA_HEIGHT = 200;

export interface ComposerProps {
  thread: Thread | undefined;
}

/** The composer's own width decides the layout, not the window's. */
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export function Composer({ thread }: ComposerProps) {
  const rpc = useRpc();
  const navigate = useNavigate();
  const connection = useAppStore((state) => state.connection);
  const providers = useAppStore((state) => state.providers);
  const settings = useAppStore((state) => state.settings);
  const upsertThread = useAppStore((state) => state.upsertThread);
  const setMessages = useAppStore((state) => state.setMessages);
  const setEvents = useAppStore((state) => state.setEvents);

  const [input, setInput] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  const compact = width > 0 && width < COMPACT_WIDTH;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fileBridge] = useState(hasFilePathBridge);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const councilMode = thread?.executionMode === 'council';
  const council = useCouncilGoal(councilMode ? thread?.id : undefined);
  const summary = useMemo(
    () => (council.status === null ? null : councilSummary(council.status)),
    [council.status],
  );

  const provider = useMemo(
    () => providers.find((entry) => entry.id === thread?.providerId),
    [providers, thread?.providerId],
  );

  const trigger = parseTrigger(input);
  const triggerKind = trigger?.kind ?? null;
  const triggerQuery = trigger?.query ?? '';
  const palette = useProjectPalette(
    thread?.projectId,
    triggerKind !== null || input.startsWith('/'),
  );

  const paletteEntries = useMemo(() => {
    if (!triggerKind) return [];
    const source: readonly (Command | Skill)[] =
      triggerKind === 'command' ? palette.commands : palette.skills;
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
  }, [input, councilMode]);

  const running = thread?.status === 'running';
  const connected = connection === 'open';
  const canSend = thread !== undefined && connected && !sending && input.trim().length > 0;
  const canSendGoal =
    thread !== undefined && connected && !council.starting && goalInput.trim().length > 0;

  const permissionSegments = useMemo<readonly SegmentedOption<PermissionMode>[]>(() => {
    const values = PERMISSION_SEGMENTS.includes(thread?.permissionMode ?? 'ask')
      ? PERMISSION_SEGMENTS
      : [thread?.permissionMode ?? 'ask', ...PERMISSION_SEGMENTS];
    return values.map((value) => ({ value, label: PERMISSION_LABEL[value] }));
  }, [thread?.permissionMode]);

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

  /** Sends one user turn. Command results and the Enter key both come through here. */
  async function sendTurn(text: string): Promise<void> {
    if (!thread || !connected) return;
    const outgoing = text.trim();
    if (outgoing.length === 0) return;
    const sentAttachments = attachments;
    const messageId = nextLocalUserMessageId(thread.id);
    addLocalUserMessage({
      id: messageId,
      threadId: thread.id,
      turnId: null,
      text: outgoing,
      attachments: sentAttachments,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setSending(true);
    setInput('');
    setAttachments([]);
    setHint(null);
    try {
      const result = await rpc.request('threads.send', {
        id: thread.id,
        text: outgoing,
        ...(sentAttachments.length > 0 ? { attachments: sentAttachments } : {}),
      });
      resolveLocalUserMessage(messageId, result.turnId);
    } catch (error) {
      failLocalUserMessage(messageId);
      toast.error(error instanceof Error ? error.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  }

  /** Re-reads the transcript after the server rewrote it (clear or compact). */
  async function refreshTranscript(threadId: string): Promise<void> {
    const [messages, page] = await Promise.all([
      rpc.request('messages.list', { threadId }),
      rpc.request('threads.events', { id: threadId, sinceSeq: 0, limit: 1000 }),
    ]);
    setMessages(threadId, messages);
    setEvents(threadId, page.events);
    clearLocalUserMessages(threadId);
  }

  /** Runs one slash input through the server and carries out what it decided. */
  async function runSlash(text: string): Promise<void> {
    if (!thread) return;
    const threadId = thread.id;
    setSending(true);
    try {
      const result = await rpc.request('commands.run', { threadId, input: text });
      if (result.kind !== 'error') {
        setInput('');
        setHint(null);
      }
      await dispatchCommandResult(result, {
        openModelPicker: () => setModelPickerOpen(true),
        switchMode: (mode) => {
          // The server already wrote threads.update; mirror it so the mode control
          // flips before the thread.updated event lands.
          upsertThread({ ...thread, executionMode: mode });
        },
        openSettings: (section) => {
          void navigate({ to: '/settings/{-$section}', params: { section } });
        },
        showContext: (preview) => requestInspectorTab('context', preview),
        reloadTranscript: async (message) => {
          await refreshTranscript(threadId);
          setNotice(message);
        },
        showText: (message) => setNotice(message),
        sendTurn: (next) => sendTurn(next),
        showError: (message) => toast.error(message),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not run the command.');
    } finally {
      setSending(false);
    }
  }

  async function send(): Promise<void> {
    if (!thread || !canSend) return;
    const text = input.trim();
    if (text.length === 0) return;
    // Any leading slash token goes through the server; an unknown name comes back
    // as a turn, so ordinary text that happens to start with a slash is not lost.
    if (slashCommandName(text) !== null) {
      await runSlash(text);
      return;
    }
    await sendTurn(text);
  }

  async function sendGoal(): Promise<void> {
    if (!canSendGoal) return;
    if (await council.start(goalInput)) setGoalInput('');
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
    const usage =
      triggerKind === 'command' && 'argumentHint' in entry && entry.argumentHint !== null
        ? `/${entry.name} ${entry.argumentHint}`
        : null;
    setInput(next);
    setHint(usage);
    setNotice(null);
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

    // Enter sends, Shift+Enter adds a line, and the modifier form always sends.
    const sends = event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey);
    if (sends) {
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

  const attachLabel = fileBridge ? 'Attach files' : 'Attach a folder';

  return (
    <div ref={rootRef} className="shrink-0 border-t border-border px-3 py-3">
      <div className="relative mx-auto w-full max-w-[var(--chat-content-max-width)]">
        {councilMode ? (
          <CouncilStatusStrip
            summary={summary}
            goalText={council.status?.goal.text}
            error={council.error}
          />
        ) : null}

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
              <div className="max-h-64 overflow-y-auto">
                <ul className="p-1 pb-2" aria-label={paletteLabel[triggerKind]}>
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
                          // Keeps scrollIntoView from parking the active row under the fade.
                          'scroll-mb-6',
                          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                          index === activeIndex
                            ? 'bg-foreground/[0.08] ring-1 ring-border/60 ring-inset'
                            : 'hover:bg-accent',
                        )}
                      >
                        <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs text-foreground">
                          <span className="truncate">
                            {triggerKind === 'command' ? '/' : '$'}
                            {entry.name}
                          </span>
                          {triggerKind === 'command' &&
                          'argumentHint' in entry &&
                          entry.argumentHint !== null ? (
                            <span className="truncate text-2xs text-muted-foreground">
                              {entry.argumentHint}
                            </span>
                          ) : null}
                        </span>
                        <span className="line-clamp-1 text-2xs text-muted-foreground">
                          {entry.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {/* Sticky, so it masks the edge while scrolling and sits below the
                    last row (after the list's 8px bottom padding) at the end. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none sticky bottom-0 h-6 bg-gradient-to-t from-popover to-transparent"
                />
              </div>
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

        {notice !== null ? (
          <div
            data-testid="command-notice"
            className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
          >
            <pre className="min-w-0 flex-1 font-mono text-2xs leading-5 whitespace-pre-wrap text-foreground/90">
              {notice}
            </pre>
            <button
              type="button"
              aria-label="Dismiss command output"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => setNotice(null)}
            >
              <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            </button>
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-message-surface/80 p-3 backdrop-blur-md transition-colors duration-150 focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/40 focus-within:ring-inset">
          {councilMode ? (
            <CouncilGoal
              value={goalInput}
              onChange={setGoalInput}
              onSend={() => void sendGoal()}
              starting={council.starting}
              canSend={canSendGoal}
              disabled={!thread}
            />
          ) : (
            <>
              {attachments.length > 0 ? (
                <div className="mb-1 flex flex-wrap gap-1.5 px-1">
                  {attachments.map((attachment, index) => (
                    <span
                      key={`${attachment.path}-${index}`}
                      className="inline-flex max-w-60 items-center gap-1 rounded-sm border border-border bg-background/40 px-1.5 py-0.5 text-2xs text-muted-foreground"
                      title={attachment.path}
                    >
                      <Paperclip
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="size-3 shrink-0"
                      />
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

              {hint !== null && !paletteOpen ? (
                <p
                  data-testid="command-hint"
                  className="truncate px-1 pb-1 font-mono text-2xs text-muted-foreground"
                >
                  {hint}
                </p>
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
                <SegmentedControl
                  ariaLabel="Execution mode"
                  testId="mode-select"
                  value={thread?.executionMode === 'plan' ? 'plan' : thread ? 'work' : null}
                  options={MODE_OPTIONS}
                  disabled={!thread || updating}
                  onValueChange={(value) => {
                    if (value !== thread?.executionMode) void applyUpdate({ executionMode: value });
                  }}
                />

                <div data-testid="model-picker-trigger" className="max-w-52 min-w-20">
                  <ModelPicker
                    provider={provider}
                    value={thread?.modelId ?? null}
                    open={modelPickerOpen}
                    onOpenChange={setModelPickerOpen}
                    disabled={!thread || updating}
                    onSelect={(modelId) => {
                      if (modelId !== thread?.modelId) void applyUpdate({ modelId });
                    }}
                    className="w-full min-w-0"
                  />
                </div>

                {thread && (settings?.showContextMeter ?? true) ? (
                  <ContextMeter
                    threadId={thread.id}
                    threshold={
                      settings?.contextWarningThreshold ?? DEFAULT_CONTEXT_WARNING_THRESHOLD
                    }
                  />
                ) : null}

                <div className="ml-auto flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <IconButton
                          icon={Paperclip}
                          label={attachLabel}
                          size="sm"
                          disabled={!thread || sending}
                          onClick={() => void attach()}
                        />
                      }
                    />
                    <TooltipContent>{attachLabel}</TooltipContent>
                  </Tooltip>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFiles}
                  />

                  {compact ? (
                    <PermissionMenu
                      value={thread?.permissionMode ?? null}
                      disabled={!thread || updating}
                      onValueChange={(value) => {
                        if (value !== thread?.permissionMode) {
                          void applyUpdate({ permissionMode: value });
                        }
                      }}
                    />
                  ) : (
                    <SegmentedControl
                      ariaLabel="Permission mode"
                      testId="permission-select"
                      value={thread?.permissionMode ?? null}
                      options={permissionSegments}
                      disabled={!thread || updating}
                      onValueChange={(value) => {
                        if (value !== thread?.permissionMode) {
                          void applyUpdate({ permissionMode: value });
                        }
                      }}
                    />
                  )}

                  {running ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stopping}
                      onClick={() => void stop()}
                    >
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
                      {sending ? (
                        <Spinner size="sm" label="Sending" />
                      ) : (
                        <ArrowUp strokeWidth={1.75} />
                      )}
                      Send
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface PermissionMenuProps {
  value: PermissionMode | null;
  disabled: boolean;
  onValueChange: (value: PermissionMode) => void;
}

/** The permission control below 720px: a menu button that never truncates. */
function PermissionMenu({ value, disabled, onValueChange }: PermissionMenuProps) {
  return (
    <PopoverRoot>
      <PopoverTrigger
        disabled={disabled}
        aria-label="Permission mode"
        title={value ? `Permission: ${PERMISSION_LABEL[value]}` : 'Permission mode'}
        data-testid="permission-select"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5 px-2 text-2xs')}
      >
        <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
        <span className="whitespace-nowrap">{value ? PERMISSION_LABEL[value] : 'Permission'}</span>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-44 p-1">
        <ul aria-label="Permission mode">
          {PERMISSION_MENU.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => onValueChange(option.value)}
                className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-foreground hover:bg-accent"
              >
                <Check
                  aria-hidden="true"
                  strokeWidth={2}
                  className={cn(
                    'size-3.5 shrink-0',
                    option.value === value ? 'text-primary' : 'opacity-0',
                  )}
                />
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </PopoverRoot>
  );
}
