/**
 * Narrow accessors for `node:sqlite` result rows. The driver types rows as
 * `Record<string, unknown>`, so every column read goes through one of these helpers
 * instead of a cast at the call site.
 */

export type SqlRow = Record<string, unknown>;

export function asRow(value: unknown): SqlRow {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected a database row');
  }
  return value as SqlRow;
}

export function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`column ${column} is not text`);
  }
  return value;
}

export function nullableText(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`column ${column} is not text`);
  }
  return value;
}

export function integer(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`column ${column} is not an integer`);
}

/** REAL columns (SQLite stores them as doubles). */
export function real(row: SqlRow, column: string): number {
  return integer(row, column);
}

export function nullableInteger(row: SqlRow, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`column ${column} is not an integer`);
}

export function boolean(row: SqlRow, column: string): boolean {
  return integer(row, column) !== 0;
}

/** Parses a JSON text column. The caller owns validating the decoded shape. */
export function json(row: SqlRow, column: string): unknown {
  const raw = text(row, column);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`column ${column} is not valid JSON`);
  }
}
