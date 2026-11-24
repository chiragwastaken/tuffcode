import type { DiffFile, DiffFileStatus } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  DIFF_STATUS_META,
  MAX_COMMENT_LENGTH,
  WORKING_TREE_CHECKPOINT,
  buildDiffTree,
  checkpointIdFromValue,
  checkpointValue,
  diffRequestKey,
  directoryOf,
  readFileTreeCollapsed,
  shouldApplyDiffResponse,
  summarizeDiff,
  validateCommentDraft,
  writeFileTreeCollapsed,
  type PreferenceStore,
} from './diff-model';

function makeFile(overrides: Partial<DiffFile> & { path: string }): DiffFile {
  return {
    oldPath: null,
    status: 'modified',
    binary: false,
    additions: 1,
    deletions: 1,
    patch: null,
    ...overrides,
  };
}

/** A `Storage` stand-in for the preference helpers. */
function memoryStore(): PreferenceStore {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe('buildDiffTree', () => {
  it('groups files by directory with the worktree root first', () => {
    const tree = buildDiffTree([
      makeFile({ path: 'src/b.ts' }),
      makeFile({ path: 'README.md' }),
      makeFile({ path: 'src/a.ts' }),
      makeFile({ path: 'docs/guide/setup.md' }),
    ]);

    expect(tree.map((directory) => directory.path)).toEqual(['', 'docs/guide', 'src']);
    expect(tree.map((directory) => directory.label)).toEqual(['./', 'docs/guide', 'src']);
    expect(tree[0]?.files.map((file) => file.name)).toEqual(['README.md']);
    expect(tree[2]?.files.map((file) => file.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('sums additions and deletions per directory and in total', () => {
    const files = [
      makeFile({ path: 'src/a.ts', additions: 3, deletions: 1 }),
      makeFile({ path: 'src/b.ts', additions: 2, deletions: 5 }),
      makeFile({ path: 'root.ts', additions: 1, deletions: 0 }),
    ];
    const tree = buildDiffTree(files);

    const src = tree.find((directory) => directory.path === 'src');
    expect(src?.fileCount).toBe(2);
    expect(src?.additions).toBe(5);
    expect(src?.deletions).toBe(6);
    expect(summarizeDiff(files)).toEqual({ fileCount: 3, additions: 6, deletions: 6 });
  });

  it('normalizes windows separators and keeps the status on each row', () => {
    const tree = buildDiffTree([
      makeFile({ path: 'src\\win.ts', status: 'added' }),
      makeFile({ path: 'src/old.ts', status: 'deleted' }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toBe('src');
    expect(tree[0]?.files.map((file) => [file.name, file.status])).toEqual([
      ['old.ts', 'deleted'],
      ['win.ts', 'added'],
    ]);
  });

  it('returns no directories for an empty diff', () => {
    expect(buildDiffTree([])).toEqual([]);
  });

  it('splits the directory off a path', () => {
    expect(directoryOf('src/a.ts')).toBe('src');
    expect(directoryOf('a.ts')).toBe('');
    expect(directoryOf('src\\deep\\a.ts')).toBe('src/deep');
  });
});

describe('DIFF_STATUS_META', () => {
  it('labels every diff status with a glyph', () => {
    const statuses: DiffFileStatus[] = [
      'added',
      'modified',
      'deleted',
      'renamed',
      'copied',
      'untracked',
      'conflicted',
    ];

    for (const status of statuses) {
      const meta = DIFF_STATUS_META[status];
      expect(meta.glyph.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.className.length).toBeGreaterThan(0);
    }
  });
});

describe('diff request keying', () => {
  it('keys a request by thread and checkpoint', () => {
    const workingTree = diffRequestKey('t1', null);
    expect(diffRequestKey('t1', null)).toBe(workingTree);
    expect(diffRequestKey('t1', undefined)).toBe(workingTree);
    expect(diffRequestKey('t1', 'c1')).not.toBe(workingTree);
    expect(diffRequestKey('t2', null)).not.toBe(workingTree);
    expect(diffRequestKey('t2', null)).not.toBe(diffRequestKey('t1', 'c1'));
  });

  it('only applies a response that matches the active key', () => {
    const active = diffRequestKey('t1', 'c1');

    expect(shouldApplyDiffResponse(active, diffRequestKey('t1', 'c1'))).toBe(true);
    expect(shouldApplyDiffResponse(active, diffRequestKey('t1', 'c2'))).toBe(false);
    expect(shouldApplyDiffResponse(active, diffRequestKey('t2', 'c1'))).toBe(false);
  });

  it('round trips the checkpoint select value', () => {
    expect(checkpointValue(null)).toBe(WORKING_TREE_CHECKPOINT);
    expect(checkpointValue('c1')).toBe('c1');
    expect(checkpointIdFromValue(WORKING_TREE_CHECKPOINT)).toBeNull();
    expect(checkpointIdFromValue('')).toBeNull();
    expect(checkpointIdFromValue(null)).toBeNull();
    expect(checkpointIdFromValue('c1')).toBe('c1');
  });
});

describe('validateCommentDraft', () => {
  it('rejects an empty or whitespace-only body', () => {
    expect(validateCommentDraft('')).toEqual({ body: 'Write a comment before adding it.' });
    expect(validateCommentDraft('   \n\t ')).toEqual({
      body: 'Write a comment before adding it.',
    });
  });

  it('rejects a body over the length limit', () => {
    expect(validateCommentDraft('a'.repeat(MAX_COMMENT_LENGTH + 1))).toEqual({
      body: `Keep the comment under ${MAX_COMMENT_LENGTH} characters.`,
    });
  });

  it('accepts a body at the limit and trims the count', () => {
    expect(validateCommentDraft('a'.repeat(MAX_COMMENT_LENGTH))).toEqual({});
    expect(validateCommentDraft(`  ${'a'.repeat(MAX_COMMENT_LENGTH)}  `)).toEqual({});
    expect(validateCommentDraft('Looks wrong to me.')).toEqual({});
  });
});

describe('file tree preference', () => {
  it('defaults to expanded and remembers a collapse', () => {
    const storage = memoryStore();

    expect(readFileTreeCollapsed(storage)).toBe(false);
    writeFileTreeCollapsed(storage, true);
    expect(readFileTreeCollapsed(storage)).toBe(true);
    writeFileTreeCollapsed(storage, false);
    expect(readFileTreeCollapsed(storage)).toBe(false);
  });

  it('forgets the preference when storage is missing or throws', () => {
    const broken: PreferenceStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readFileTreeCollapsed(null)).toBe(false);
    expect(readFileTreeCollapsed(broken)).toBe(false);
    expect(() => {
      writeFileTreeCollapsed(broken, true);
    }).not.toThrow();
    expect(() => {
      writeFileTreeCollapsed(null, true);
    }).not.toThrow();
  });
});
