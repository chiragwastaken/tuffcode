import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tokenPath } from '@tuffcode/shared';

/**
 * Reads the bearer token from `tokenPath()`, creating a 32 byte random token with
 * mode 0600 when the file is missing or empty. The file is the single source of
 * truth, so the server and the renderer bootstrap never disagree.
 */
export function ensureToken(): string {
  const file = tokenPath();
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length > 0) return existing;
  } catch {
    // Missing file: create one below.
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX mode bits; the ACL inherits from the user profile.
  }
  return token;
}

/**
 * Constant-time comparison against the token file. A length mismatch returns false
 * before `timingSafeEqual`, which throws on unequal buffer lengths.
 */
export function verifyToken(candidate: string | undefined | null): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  let expected: string;
  try {
    expected = readFileSync(tokenPath(), 'utf8').trim();
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const provided = Buffer.from(candidate, 'utf8');
  const stored = Buffer.from(expected, 'utf8');
  if (provided.length !== stored.length) return false;
  return timingSafeEqual(provided, stored);
}
