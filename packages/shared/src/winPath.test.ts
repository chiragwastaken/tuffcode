import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, normalizePath, resolveWithin, toLongPath } from '@tuffcode/shared';

const isWindows = process.platform === 'win32';

describe('normalizePath', () => {
  it('collapses separators and dot segments', () => {
    expect(normalizePath('a//b/../c')).toBe(join('a', 'c'));
  });

  it('leaves an extended-length prefix intact', () => {
    if (!isWindows) return;
    expect(normalizePath('\\\\?\\C:\\a\\..\\b')).toBe('\\\\?\\C:\\b');
  });
});

describe('toLongPath', () => {
  it('leaves short paths alone', () => {
    expect(toLongPath('C:\\short')).toBe('C:\\short');
  });

  it('prefixes absolute paths at or beyond 248 characters', () => {
    if (!isWindows) {
      expect(toLongPath(`/${'a'.repeat(300)}`)).toBe(`/${'a'.repeat(300)}`);
      return;
    }
    const long = `C:\\${'a'.repeat(260)}`;
    expect(toLongPath(long)).toBe(`\\\\?\\${long}`);
  });

  it('does not double-prefix and handles UNC roots', () => {
    if (!isWindows) return;
    const long = `C:\\${'a'.repeat(260)}`;
    expect(toLongPath(`\\\\?\\${long}`)).toBe(`\\\\?\\${long}`);

    const unc = `\\\\server\\share\\${'b'.repeat(250)}`;
    expect(toLongPath(unc)).toBe(`\\\\?\\UNC\\server\\share\\${'b'.repeat(250)}`);
  });

  it('never prefixes relative paths', () => {
    expect(toLongPath(`${'c'.repeat(260)}`)).toBe(`${'c'.repeat(260)}`);
  });
});

describe('isInside', () => {
  const root = resolve('root');

  it('accepts the root itself and descendants', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, 'src', 'index.ts'))).toBe(true);
  });

  it('rejects parent traversal and absolute siblings', () => {
    expect(isInside(root, join(root, '..', 'escape.txt'))).toBe(false);
    expect(isInside(root, join(dirname(root), 'sibling.txt'))).toBe(false);
    expect(isInside(root, resolve(root, '..', '..', 'elsewhere'))).toBe(false);
  });

  it('allows names that merely start with two dots', () => {
    expect(isInside(root, join(root, '..cache', 'file.txt'))).toBe(true);
  });

  it('is case-insensitive on win32', () => {
    if (!isWindows) return;
    expect(isInside('C:\\Root', 'c:\\root\\file.txt')).toBe(true);
  });
});

describe('resolveWithin', () => {
  const root = resolve('root');

  it('resolves inside paths', () => {
    expect(resolveWithin(root, join('src', 'index.ts'))).toBe(resolve(root, 'src', 'index.ts'));
    expect(resolveWithin(root, join('src', '..', 'ok.txt'))).toBe(resolve(root, 'ok.txt'));
  });

  it('throws on escape attempts', () => {
    expect(() => resolveWithin(root, '..\\escape.txt')).toThrow(/escapes root/);
    expect(() => resolveWithin(root, '../escape.txt')).toThrow(/escapes root/);
    expect(() => resolveWithin(root, '..')).toThrow(/escapes root/);
  });
});
