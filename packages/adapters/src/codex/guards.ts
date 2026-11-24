/**
 * Canonical runtime guards for the Codex wire payloads. The app-server schema
 * is generated from Rust and can add fields between CLI releases, so the
 * adapter reads only the fields it consumes and ignores the rest.
 */
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}
