/**
 * Tool arguments are persisted and broadcast in `tool.started`, so secret-shaped keys are
 * masked before the event leaves the adapter. The executed arguments stay untouched.
 */
const SECRET_KEY =
  /^(api_?key|secret|secret_?env|token|auth_?token|access_?token|refresh_?token|client_?secret|password|credential|authorization)$/i;
const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_KEYS = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-copies plain objects and arrays, replacing the value of any secret-shaped key with
 * `[redacted]`. Containers deeper than the depth cap collapse to the marker, and the key
 * budget stops the walk, so neither a cyclic input nor a huge one can smuggle a value out.
 */
export function redactToolInput(input: unknown): unknown {
  let budget = MAX_KEYS;

  function walk(value: unknown, depth: number): unknown {
    if (Array.isArray(value)) {
      if (depth >= MAX_DEPTH) return REDACTED;
      const copy: unknown[] = [];
      for (const entry of value) {
        if (budget <= 0) break;
        budget -= 1;
        copy.push(walk(entry, depth + 1));
      }
      return copy;
    }
    if (isPlainObject(value)) {
      if (depth >= MAX_DEPTH) return REDACTED;
      const copy: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (budget <= 0) break;
        budget -= 1;
        copy[key] = SECRET_KEY.test(key) ? REDACTED : walk(entry, depth + 1);
      }
      return copy;
    }
    return value;
  }

  return walk(input, 0);
}
