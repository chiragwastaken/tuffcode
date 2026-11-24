import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUserDataPath } from './user-data';

describe('resolveUserDataPath', () => {
  it('keeps the default when the variable is unset', () => {
    expect(resolveUserDataPath({})).toBeUndefined();
  });

  it('keeps the default when the variable is blank', () => {
    expect(resolveUserDataPath({ TUFFCODE_USER_DATA: '   ' })).toBeUndefined();
  });

  it('uses an absolute override as given', () => {
    const target = join(tmpdir(), 'tuffcode-user-data-test');
    expect(resolveUserDataPath({ TUFFCODE_USER_DATA: target })).toBe(resolve(target));
  });

  it('trims surrounding whitespace', () => {
    const target = join(tmpdir(), 'tuffcode-user-data-test');
    expect(resolveUserDataPath({ TUFFCODE_USER_DATA: `  ${target}  ` })).toBe(resolve(target));
  });

  it('resolves a relative override against the working directory', () => {
    expect(resolveUserDataPath({ TUFFCODE_USER_DATA: 'relative/user-data' })).toBe(
      resolve('relative/user-data'),
    );
  });
});
