import type { DiffFile, DiffFileStatus, ReviewCommentSide } from '@tuffcode/contracts';

/** Select value that stands for the live working tree instead of a checkpoint. */
export const WORKING_TREE_CHECKPOINT = 'working-tree';

/** Checkpoint select value for a checkpoint id, or the working tree sentinel. */
export function checkpointValue(checkpointId: string | null | undefined): string {
  return checkpointId ?? WORKING_TREE_CHECKPOINT;
}

/** Turns a checkpoint select value back into the RPC checkpoint id. */
export function checkpointIdFromValue(value: string | null | undefined): string | null {
  if (!value || value === WORKING_TREE_CHECKPOINT) return null;
  return value;
}

/**
 * Identity of one `diff.get` request. The panel keeps this key while a request
 * is in flight so a response for an older thread or checkpoint is discarded.
 */
export function diffRequestKey(threadId: string, checkpointId: string | null | undefined): string {
  return `${threadId}::${checkpointValue(checkpointId)}`;
}

/** True when a response still belongs to the request the panel is waiting on. */
export function shouldApplyDiffResponse(activeKey: string, responseKey: string): boolean {
  return activeKey === responseKey;
}

export interface DiffStatusMeta {
  glyph: string;
  label: string;
  className: string;
}

/** Status glyphs and tones shown in the file tree. */
export const DIFF_STATUS_META: Record<DiffFileStatus, DiffStatusMeta> = {
  added: { glyph: '+', label: 'Added', className: 'text-success-foreground' },
  untracked: { glyph: '+', label: 'Untracked', className: 'text-success-foreground' },
  modified: { glyph: 'M', label: 'Modified', className: 'text-warning-foreground' },
  deleted: { glyph: '-', label: 'Deleted', className: 'text-error-foreground' },
  renamed: { glyph: 'R', label: 'Renamed', className: 'text-info-foreground' },
  copied: { glyph: 'C', label: 'Copied', className: 'text-info-foreground' },
  conflicted: { glyph: '!', label: 'Conflicted', className: 'text-error-foreground' },
};

export interface DiffTreeFile {
  path: string;
  name: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffTreeDirectory {
  /** Directory path with forward slashes; empty for the worktree root. */
  path: string;
  /** Row label; `./` for the root. */
  label: string;
  files: DiffTreeFile[];
  fileCount: number;
  additions: number;
  deletions: number;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Directory part of a worktree-relative path, empty for the root. */
export function directoryOf(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
}

function fileNameOf(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  return a.localeCompare(b);
}

/**
 * Groups changed files by their directory. Directories are sorted with the
 * worktree root first; files inside a directory are sorted by name.
 */
export function buildDiffTree(files: readonly DiffFile[]): DiffTreeDirectory[] {
  const groups = new Map<string, DiffTreeFile[]>();

  for (const file of files) {
    const path = normalizePath(file.path);
    const directory = directoryOf(path);
    const entry: DiffTreeFile = {
      path,
      name: fileNameOf(path),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
    };
    const existing = groups.get(directory);
    if (existing) {
      existing.push(entry);
      continue;
    }
    groups.set(directory, [entry]);
  }

  const tree: DiffTreeDirectory[] = [];
  for (const [path, group] of groups) {
    const sorted = group.toSorted((a, b) => {
      const byName = a.name.localeCompare(b.name);
      return byName === 0 ? a.path.localeCompare(b.path) : byName;
    });
    let additions = 0;
    let deletions = 0;
    for (const file of sorted) {
      additions += file.additions;
      deletions += file.deletions;
    }
    tree.push({
      path,
      label: path === '' ? './' : path,
      files: sorted,
      fileCount: sorted.length,
      additions,
      deletions,
    });
  }

  return tree.toSorted((a, b) => comparePaths(a.path, b.path));
}

export interface DiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

export function summarizeDiff(files: readonly DiffFile[]): DiffSummary {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { fileCount: files.length, additions, deletions };
}

export interface PatchSides {
  oldText: string;
  newText: string;
  /** File line number for each rendered old-side line, 1-based. */
  oldLineNumbers: number[];
  /** File line number for each rendered new-side line, 1-based. */
  newLineNumbers: number[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Rebuilds the old and new sides of a unified patch so the design system diff
 * viewer can render them. Every rebuilt line keeps its real file line number,
 * which is what the inline comment affordance reports.
 */
export function splitPatchSides(patch: string | null | undefined): PatchSides | null {
  if (!patch) return null;

  const oldLines: string[] = [];
  const newLines: string[] = [];
  const oldLineNumbers: number[] = [];
  const newLineNumbers: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      if (!match) continue;
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      inHunk = true;
      continue;
    }

    if (!inHunk || line.startsWith('\\')) continue;

    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
      newLineNumbers.push(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
      oldLineNumbers.push(oldLine);
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      const text = line.slice(1);
      oldLines.push(text);
      oldLineNumbers.push(oldLine);
      oldLine += 1;
      newLines.push(text);
      newLineNumbers.push(newLine);
      newLine += 1;
    }
  }

  if (oldLines.length === 0 && newLines.length === 0) return null;

  return {
    oldText: oldLines.join('\n'),
    newText: newLines.join('\n'),
    oldLineNumbers,
    newLineNumbers,
  };
}

/**
 * Maps a rendered gutter line back to its real file line. The diff viewer
 * reports positions inside the rebuilt sides, and every rebuilt line carries
 * the line number it had in the file.
 */
export function fileLineForRenderedLine(
  sides: PatchSides | null,
  side: ReviewCommentSide,
  renderedLine: number,
): number {
  if (!sides) return renderedLine;
  const numbers = side === 'old' ? sides.oldLineNumbers : sides.newLineNumbers;
  return numbers[renderedLine - 1] ?? renderedLine;
}

export const MAX_COMMENT_LENGTH = 2000;

export interface CommentDraftErrors {
  body?: string;
}

/** Inline comment validation shared by the form and its tests. */
export function validateCommentDraft(body: string): CommentDraftErrors {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { body: 'Write a comment before adding it.' };
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return { body: `Keep the comment under ${MAX_COMMENT_LENGTH} characters.` };
  }
  return {};
}
