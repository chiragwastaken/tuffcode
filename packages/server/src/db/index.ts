import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from '@tuffcode/shared';
import { MIGRATIONS } from './migrations.js';

const IN_MEMORY = ':memory:';
const transactions = new WeakSet<DatabaseSync>();

/**
 * Opens the database at `file` (defaults to `dbPath()`), creating parent directories.
 * WAL, foreign keys and the busy timeout are connection settings, so they are applied
 * here rather than inside a migration transaction (SQLite rejects `journal_mode`
 * changes inside a transaction).
 */
export function openDb(file: string = dbPath()): DatabaseSync {
  if (file !== IN_MEMORY) {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec('PRAGMA busy_timeout=5000;');
  return db;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

function appliedVersions(db: DatabaseSync): Set<number> {
  if (!tableExists(db, 'schema_migrations')) return new Set();
  const versions = new Set<number>();
  for (const row of db.prepare('SELECT version FROM schema_migrations').all()) {
    const value = row['version'];
    if (typeof value === 'number') versions.add(value);
    else if (typeof value === 'bigint') versions.add(Number(value));
  }
  return versions;
}

/**
 * Applies every migration that `schema_migrations` does not record yet, each inside its
 * own transaction. Idempotent: a second call on a migrated database is a no-op.
 * Returns the versions applied by this call.
 */
export function migrate(db: DatabaseSync): number[] {
  const applied = appliedVersions(db);
  const fresh: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
    });
    fresh.push(migration.version);
  }
  return fresh;
}

/**
 * Runs `fn` inside `BEGIN IMMEDIATE`, committing on return and rolling back on throw.
 * Nesting is rejected: a second call while a transaction is active on the same
 * connection throws instead of silently joining the outer transaction.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (transactions.has(db)) {
    throw new Error('nested transaction');
  }
  transactions.add(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The connection may already have rolled back after a fatal statement error.
    }
    throw error;
  } finally {
    transactions.delete(db);
  }
}

/** Flushes the WAL and closes the connection. Safe to call once. */
export function closeDb(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }
}

export { MIGRATIONS } from './migrations.js';
export type { Migration } from './migrations.js';
