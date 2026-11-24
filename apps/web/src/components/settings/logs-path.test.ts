import { describe, expect, it } from 'vitest';
import { logsFolderFromDbPath } from './logs-path';

describe('logsFolderFromDbPath', () => {
  it('keeps Windows separators', () => {
    expect(logsFolderFromDbPath('C:\\Users\\Hp\\AppData\\Local\\Tuffcode\\tuffcode.db')).toBe(
      'C:\\Users\\Hp\\AppData\\Local\\Tuffcode\\logs',
    );
  });

  it('keeps POSIX separators', () => {
    expect(logsFolderFromDbPath('/home/hp/.local/share/Tuffcode/tuffcode.db')).toBe(
      '/home/hp/.local/share/Tuffcode/logs',
    );
    expect(logsFolderFromDbPath('/Users/hp/Library/Application Support/Tuffcode/tuffcode.db')).toBe(
      '/Users/hp/Library/Application Support/Tuffcode/logs',
    );
  });

  it('ignores a trailing separator', () => {
    expect(logsFolderFromDbPath('C:\\Tuffcode\\tuffcode.db\\')).toBe('C:\\Tuffcode\\logs');
  });

  it('falls back when the path has no folder', () => {
    expect(logsFolderFromDbPath('tuffcode.db')).toBe('logs');
  });
});
