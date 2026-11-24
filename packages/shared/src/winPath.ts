import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const LONG_PATH_PREFIX = '\\\\?\\';
const UNC_PREFIX = '\\\\';
const LONG_PATH_THRESHOLD = 248;

const isWindows = process.platform === 'win32';

/**
 * Normalize separators and dot segments. A `\\?\` prefix is preserved rather than
 * folded into the normalized body.
 */
export function normalizePath(input: string): string {
  if (input.length === 0) return input;
  let value = isWindows ? input.replace(/\//g, '\\') : input;
  const prefixed = isWindows && value.startsWith(LONG_PATH_PREFIX);
  if (prefixed) value = value.slice(LONG_PATH_PREFIX.length);
  const normalized = normalize(value);
  return prefixed ? `${LONG_PATH_PREFIX}${normalized}` : normalized;
}

/**
 * Add the Windows extended-length prefix (`\\?\`) when an absolute path is at least
 * 248 characters. Paths that are relative or already prefixed are returned normalized.
 */
export function toLongPath(input: string): string {
  const normalized = normalizePath(input);
  if (!isWindows || !isAbsolute(normalized) || normalized.startsWith(LONG_PATH_PREFIX)) {
    return normalized;
  }
  if (normalized.length < LONG_PATH_THRESHOLD) return normalized;
  if (normalized.startsWith(UNC_PREFIX)) {
    return `${LONG_PATH_PREFIX}UNC\\${normalized.slice(UNC_PREFIX.length)}`;
  }
  return `${LONG_PATH_PREFIX}${normalized}`;
}

function canonical(input: string): string {
  const resolved = resolve(normalizePath(input));
  return isWindows ? resolved.toLowerCase() : resolved;
}

/**
 * True when `target` is `root` itself or a descendant of `root`. `..` segments are
 * resolved first, so an escaping relative path returns false. Case-insensitive on
 * Windows.
 */
export function isInside(root: string, target: string): boolean {
  const base = canonical(root);
  const candidate = canonical(target);
  if (base === candidate) return true;
  const rel = relative(base, candidate);
  if (rel.length === 0) return true;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve `rel` against `root`, throwing when the result escapes the root. Used by
 * file tools that must never touch paths outside the worktree.
 */
export function resolveWithin(root: string, rel: string): string {
  const base = resolve(normalizePath(root));
  const candidate = resolve(base, normalizePath(rel));
  if (!isInside(base, candidate)) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return candidate;
}
