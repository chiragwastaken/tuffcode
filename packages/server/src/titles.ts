import type { SubagentType } from '@tuffcode/contracts';
import type { Repos } from './db/repos/index.js';

/**
 * One-line chat titles derived from the opening prompt, offline and deterministic:
 * no model call, no network. A title the user typed is never rewritten because only
 * placeholder titles are replaced.
 */
export const DEFAULT_THREAD_TITLE = 'New chat';

export const MAX_TITLE_CHARS = 60;

const LEGACY_THREAD_TITLE = /^Thread [0-9a-z]{8}$/;
const LEGACY_SUBAGENT_TITLE = /^Subagent (explorer|reviewer|notetaker|worker|planner) [0-9a-z]{8}$/;
const FENCED_CODE = /```[\s\S]*?(```|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const URL = /\b(?:https?|ftp|file):\/\/\S+/gi;
const SKILL_MENTION = /(^|\s)\$[A-Za-z0-9][\w-]*/g;
const LEADING_COMMAND = /^\/[A-Za-z0-9][\w-]*\s*/;
const FILLER_PREFIX = /^(?:please|pls|hey|hi|hello|ok|okay|so|can you|could you|would you|will you)\b[\s,:]*/i;
const TRAILING_PLEASE = /[\s,]+please$/i;
const SENTENCE_END = /[.!?](?=\s|$)/;
const TRAILING_PUNCTUATION = /[\s.,;:!?-]+$/;
const MEANINGFUL = /[\p{L}\p{N}]/u;

const SUBAGENT_LABEL: Record<SubagentType, string> = {
  explorer: 'Explorer',
  reviewer: 'Reviewer',
  notetaker: 'Notetaker',
  worker: 'Worker',
  planner: 'Planner',
};

export function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.length === 0 ||
    trimmed === DEFAULT_THREAD_TITLE ||
    LEGACY_THREAD_TITLE.test(trimmed) ||
    LEGACY_SUBAGENT_TITLE.test(trimmed)
  );
}

function cutAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars + 1);
  const space = window.lastIndexOf(' ');
  return (space > maxChars / 3 ? window.slice(0, space) : text.slice(0, maxChars)).replace(
    TRAILING_PUNCTUATION,
    '',
  );
}

/** The opening prompt reduced to one short sentence-case line, or null when nothing is left. */
export function deriveTitle(text: string, maxChars = MAX_TITLE_CHARS): string | null {
  const withoutCode = text.replace(/\r\n?/g, '\n').replace(FENCED_CODE, '\n');
  const firstLine =
    withoutCode
      .split('\n')
      .map((line) => line.trim())
      .find((line) => MEANINGFUL.test(line.replace(INLINE_CODE, ''))) ?? '';

  let line = firstLine
    .replace(LEADING_COMMAND, '')
    .replace(INLINE_CODE, ' ')
    .replace(URL, ' ')
    .replace(SKILL_MENTION, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const end = SENTENCE_END.exec(line);
  if (end !== null && end.index > 0) line = line.slice(0, end.index);

  for (let guard = 0; guard < 3; guard += 1) {
    const next = line.replace(FILLER_PREFIX, '');
    if (next === line) break;
    line = next;
  }
  line = line.replace(TRAILING_PLEASE, '').replace(TRAILING_PUNCTUATION, '').trim();
  if (!MEANINGFUL.test(line)) return null;

  const cased = line.charAt(0).toLocaleUpperCase() + line.slice(1);
  return cutAtWord(cased, maxChars);
}

/** "Explorer: Map the runner send path", or "Explorer subagent" when the task has no words. */
export function subagentTitle(type: SubagentType, task: string): string {
  const label = SUBAGENT_LABEL[type];
  const derived = deriveTitle(task, MAX_TITLE_CHARS - label.length - 2);
  return derived === null ? `${label} subagent` : `${label}: ${derived}`;
}

/**
 * Startup repair for threads created before round 4, whose titles are id fragments.
 * Subagent children take their type and task; other threads take their first user
 * message. Threads with no usable text keep their title. Returns the number renamed.
 */
export function backfillTitles(repos: Repos, now = new Date().toISOString()): number {
  const children = new Map(
    repos.subagents
      .listAll()
      .filter((record) => record.childThreadId !== null)
      .map((record) => [record.childThreadId as string, record] as const),
  );
  let renamed = 0;
  for (const thread of repos.threads.list()) {
    if (!isPlaceholderTitle(thread.title)) continue;
    const child = children.get(thread.id);
    let title: string | null;
    if (child !== undefined) {
      title = subagentTitle(child.type, child.task);
    } else {
      const first = repos.messages.list(thread.id, 20).find((message) => message.role === 'user');
      title = first === undefined ? null : deriveTitle(first.content);
    }
    if (title === null || title === thread.title) continue;
    repos.threads.update(thread.id, { title, updatedAt: thread.updatedAt || now });
    renamed += 1;
  }
  return renamed;
}
