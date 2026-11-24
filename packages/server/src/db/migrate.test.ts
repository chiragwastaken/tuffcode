import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempEnv, type TempEnv } from '../test-support.js';
import { migrate, openDb, transaction } from './index.js';

describe('db migrations', () => {
  let env: TempEnv | undefined;

  afterEach(() => {
    env?.dispose();
    env = undefined;
  });

  it('applies the schema once and is idempotent', () => {
    env = createTempEnv();
    const db = openDb(join(env.root, 'tuffcode.db'));
    try {
      expect(migrate(db)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(migrate(db)).toEqual([]);

      const versions = db.prepare('SELECT version FROM schema_migrations').all();
      expect(versions).toHaveLength(7);
      expect(versions.map((row) => row['version'])).toEqual([1, 2, 3, 4, 5, 6, 7]);

      expect(db.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal');
      expect(db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1);
      expect(db.prepare('PRAGMA busy_timeout').get()?.['timeout']).toBe(5000);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row['name']);
      for (const table of [
        'projects',
        'threads',
        'events',
        'messages',
        'checkpoints',
        'approvals',
        'providers',
        'provider_models',
        'settings',
        'review_comments',
        'goals',
        'tasks',
        'reviews',
        'escalations',
        'brain_entries',
        'brain_edges',
        'brain_fts',
        'terminal_sessions',
        'turns',
        'subagents',
      ]) {
        expect(tables).toContain(table);
      }
    } finally {
      db.close();
    }
  });

  it('accepts the anthropic provider kind and keeps the model cascade', () => {
    env = createTempEnv();
    const db = openDb(join(env.root, 'tuffcode.db'));
    migrate(db);
    try {
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO providers (id, kind, label, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('prv_anthropic', 'anthropic', 'Anthropic', '{}', now, now);
      db.prepare('INSERT INTO provider_models (provider_id, model_id, label) VALUES (?, ?, ?)').run(
        'prv_anthropic',
        'claude-opus-4-5',
        'Opus',
      );
      db.prepare('DELETE FROM providers WHERE id = ?').run('prv_anthropic');
      expect(db.prepare('SELECT COUNT(*) AS total FROM provider_models').get()?.['total']).toBe(0);

      expect(() =>
        db
          .prepare(
            'INSERT INTO providers (id, kind, label, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('prv_bad', 'gemini', 'Gemini', '{}', now, now),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('rolls back a throwing transaction', () => {
    env = createTempEnv();
    const db = openDb(join(env.root, 'tuffcode.db'));
    migrate(db);
    try {
      const now = new Date().toISOString();
      expect(() =>
        transaction(db, () => {
          db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
            'prj_rollback',
            'Rollback',
            env?.root ?? '',
            now,
          );
          throw new Error('boom');
        }),
      ).toThrow('boom');
      const count = db.prepare('SELECT COUNT(*) AS total FROM projects').get()?.['total'];
      expect(count).toBe(0);
    } finally {
      db.close();
    }
  });

  it('rejects nested transactions', () => {
    env = createTempEnv();
    const db = openDb(join(env.root, 'tuffcode.db'));
    migrate(db);
    try {
      expect(() =>
        transaction(db, () => {
          transaction(db, () => undefined);
        }),
      ).toThrow('nested transaction');
    } finally {
      db.close();
    }
  });
});
