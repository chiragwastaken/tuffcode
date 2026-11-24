import { statSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenPath } from '@tuffcode/shared';
import { ensureToken, verifyToken } from './auth.js';
import { createTempEnv, type TempEnv } from './test-support.js';

describe('auth token', () => {
  let env: TempEnv | undefined;

  afterEach(() => {
    env?.dispose();
    env = undefined;
  });

  it('creates a 32 byte hex token once and reuses it', () => {
    env = createTempEnv();
    const first = ensureToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(ensureToken()).toBe(first);
    const file = tokenPath();
    expect(statSync(file).size).toBe(64);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('accepts only the exact token', () => {
    env = createTempEnv();
    const token = ensureToken();
    expect(verifyToken(token)).toBe(true);
    expect(verifyToken(`${token}0`)).toBe(false);
    expect(verifyToken(token.slice(0, -1))).toBe(false);
    expect(verifyToken('')).toBe(false);
    expect(verifyToken(undefined)).toBe(false);
    expect(verifyToken(null)).toBe(false);
  });

  it('reads the token file on every check', () => {
    env = createTempEnv();
    ensureToken();
    writeFileSync(tokenPath(), 'abc123', 'utf8');
    expect(verifyToken('abc123')).toBe(true);
    expect(verifyToken('abc124')).toBe(false);
    expect(verifyToken('abc1234')).toBe(false);
  });
});
