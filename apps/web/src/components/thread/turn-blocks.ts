import {
  toolSummary,
  type ApprovalItem,
  type NoticeItem,
  type TimelineItem,
  type ToolItem,
  type UserItem,
} from './grouping';

export interface ReasoningBlock {
  kind: 'reasoning';
  key: string;
  turnId: string;
  text: string;
  streaming: boolean;
  durationMs: number | null;
}

/** Assistant text that precedes a tool call: context, not the answer. */
export interface ProseBlock {
  kind: 'prose';
  key: string;
  turnId: string;
  text: string;
  streaming: boolean;
}

export interface ToolGroupBlock {
  kind: 'tools';
  key: string;
  turnId: string;
  tools: ToolItem[];
  durationMs: number | null;
}

/** The closing assistant text, rendered as the answer with hover actions. */
export interface FinalBlock {
  kind: 'final';
  key: string;
  turnId: string;
  text: string;
  streaming: boolean;
  /** The user message this answer replies to, used by retry and edit. */
  prompt: UserItem | null;
}

export interface UserBlock {
  kind: 'user';
  key: string;
  item: UserItem;
}

export interface ApprovalBlock {
  kind: 'approval';
  key: string;
  item: ApprovalItem;
}

export interface NoticeBlock {
  kind: 'notice';
  key: string;
  item: NoticeItem;
}

export type TimelineBlock =
  | UserBlock
  | ReasoningBlock
  | ProseBlock
  | ToolGroupBlock
  | FinalBlock
  | ApprovalBlock
  | NoticeBlock;

/** Milliseconds between two ISO timestamps, or null when either is unusable. */
export function elapsedMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (startedAt === null || finishedAt === null) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Compact duration for a row: "<1s", "12s", "1m 5s", "2h 3m". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

const VERBS: Record<string, string> = {
  read: 'Read',
  read_file: 'Read',
  view: 'Read',
  write: 'Wrote',
  write_file: 'Wrote',
  create: 'Created',
  edit: 'Edited',
  edit_file: 'Edited',
  multi_edit: 'Edited',
  apply_patch: 'Edited',
  str_replace_editor: 'Edited',
  bash: 'Ran',
  shell: 'Ran',
  exec: 'Ran',
  run: 'Ran',
  terminal: 'Ran',
  grep: 'Searched',
  search: 'Searched',
  find: 'Searched',
  glob: 'Listed',
  ls: 'Listed',
  list: 'Listed',
  fetch: 'Fetched',
  web_fetch: 'Fetched',
  webfetch: 'Fetched',
};

/** The leading word of a tool row: "Read", "Ran", "Searched". */
export function toolVerb(name: string): string {
  const known = VERBS[name.toLowerCase()];
  if (known !== undefined) return known;
  const cleaned = name.replace(/[_-]+/g, ' ').trim();
  return cleaned.length === 0 ? 'Used' : `Used ${cleaned}`;
}

const COMMAND_KEYS = ['command', 'cmd', 'script', 'shell'] as const;
const PATH_KEYS = ['path', 'file_path', 'filePath', 'filename', 'file', 'dir', 'directory'] as const;
const PATTERN_KEYS = ['pattern', 'query', 'regex'] as const;

function firstLine(value: string): string {
  const [line = ''] = value.split(/\r?\n/);
  return line.trim();
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * What a tool row points at: the path it touched, the first line of a command, or
 * the pattern it searched for. Generic tools fall back to any short string input.
 */
export function toolTarget(input: unknown): string {
  if (typeof input === 'string') return firstLine(input);
  if (input === null || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const path = firstString(record, PATH_KEYS);
  if (path !== null) return firstLine(path);
  const command = firstString(record, COMMAND_KEYS);
  if (command !== null) return firstLine(command);
  const pattern = firstString(record, PATTERN_KEYS);
  if (pattern !== null) return firstLine(pattern);
  return toolSummary(input);
}

/** "Read src/index.ts" for a row and for copied tool text. */
export function toolHeadline(name: string, input: unknown): string {
  const target = toolTarget(input);
  const verb = toolVerb(name);
  return target.length === 0 ? verb : `${verb} ${target}`;
}

export type ToolDetail = 'diff' | 'output' | 'matches';

/** Which expanded body a tool gets: a diff, an output tail, or matches. */
export function toolDetail(name: string): ToolDetail {
  const normalized = name.toLowerCase();
  if (/(^|_)(edit|write|patch|create|replace)(_|$)/.test(normalized)) return 'diff';
  if (/(^|_)(grep|search)(_|$)/.test(normalized)) return 'matches';
  return 'output';
}

export interface ToolDiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

const OLD_KEYS = ['old_string', 'old_str', 'oldText', 'old_text'] as const;
const NEW_KEYS = ['new_string', 'new_str', 'newText', 'new_text', 'content'] as const;

function patchLines(text: string): ToolDiffLine[] {
  const lines: ToolDiffLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('@@')) {
      lines.push({ kind: 'context', text: raw });
      continue;
    }
    if (raw.startsWith('+')) lines.push({ kind: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ kind: 'remove', text: raw.slice(1) });
    else lines.push({ kind: 'context', text: raw.replace(/^ /, '') });
  }
  return lines;
}

/**
 * The changed lines an edit or write produced. A unified patch is used as-is;
 * otherwise the old and new fragments become removed and added lines.
 */
export function toolDiffLines(input: unknown): ToolDiffLine[] {
  if (input === null || typeof input !== 'object') return [];
  const record = input as Record<string, unknown>;
  const patch = firstString(record, ['diff', 'patch']);
  if (patch !== null) return patchLines(patch);

  const lines: ToolDiffLine[] = [];
  const oldValue = firstString(record, OLD_KEYS);
  const newValue = firstString(record, NEW_KEYS);
  if (oldValue !== null) {
    for (const line of oldValue.split(/\r?\n/)) lines.push({ kind: 'remove', text: line });
  }
  if (newValue !== null) {
    for (const line of newValue.split(/\r?\n/)) lines.push({ kind: 'add', text: line });
  }
  return lines;
}

export interface OutputTail {
  lines: string[];
  hidden: number;
}

/** The last few lines of tool output, with a count for what scrolled past. */
export function outputTail(output: string, maxLines = 12): OutputTail {
  if (output.trim().length === 0) return { lines: [], hidden: 0 };
  const lines = output.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) return { lines, hidden: 0 };
  return { lines: lines.slice(-maxLines), hidden: lines.length - maxLines };
}

/** What the copy action puts on the clipboard for a block. */
export function blockCopyText(block: TimelineBlock): string {
  switch (block.kind) {
    case 'reasoning':
    case 'prose':
    case 'final':
      return block.text;
    case 'user':
      return block.item.text;
    case 'tools':
      return block.tools
        .map((tool) => {
          const body = tool.output.trim().length > 0 ? `\n${tool.output.trim()}` : '';
          return `${toolHeadline(tool.name, tool.input)}${body}`;
        })
        .join('\n\n');
    default:
      return '';
  }
}

/**
 * Folds flat timeline rows into Claude-style turn blocks: reasoning, prose and
 * tool runs keep their event order, and consecutive tools share one surface.
 * The last assistant text of a turn is the answer; earlier text is prose.
 */
export function groupTurnBlocks(items: readonly TimelineItem[]): TimelineBlock[] {
  const lastAssistantIndex = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.kind === 'assistant') lastAssistantIndex.set(item.turnId, index);
  });

  const blocks: TimelineBlock[] = [];
  let prompt: UserItem | null = null;

  items.forEach((item, index) => {
    switch (item.kind) {
      case 'user': {
        prompt = item;
        blocks.push({ kind: 'user', key: item.key, item });
        break;
      }
      case 'reasoning': {
        blocks.push({
          kind: 'reasoning',
          key: item.key,
          turnId: item.turnId,
          text: item.text,
          streaming: item.streaming,
          durationMs: elapsedMs(item.startedAt, item.finishedAt),
        });
        break;
      }
      case 'assistant': {
        const closing = index === lastAssistantIndex.get(item.turnId);
        if (closing) {
          blocks.push({
            kind: 'final',
            key: item.key,
            turnId: item.turnId,
            text: item.text,
            streaming: item.streaming,
            prompt,
          });
        } else {
          blocks.push({
            kind: 'prose',
            key: item.key,
            turnId: item.turnId,
            text: item.text,
            streaming: item.streaming,
          });
        }
        break;
      }
      case 'tool': {
        blocks.push({
          kind: 'tools',
          key: item.key,
          turnId: item.turnId,
          tools: [item],
          durationMs: elapsedMs(item.startedAt, item.finishedAt),
        });
        break;
      }
      case 'tool-group': {
        const first = item.tools[0];
        const last = item.tools.at(-1);
        blocks.push({
          kind: 'tools',
          key: item.key,
          turnId: item.turnId,
          tools: item.tools,
          durationMs: elapsedMs(first?.startedAt ?? null, last?.finishedAt ?? null),
        });
        break;
      }
      case 'approval': {
        blocks.push({ kind: 'approval', key: item.key, item });
        break;
      }
      case 'notice': {
        blocks.push({ kind: 'notice', key: item.key, item });
        break;
      }
    }
  });

  return blocks;
}
