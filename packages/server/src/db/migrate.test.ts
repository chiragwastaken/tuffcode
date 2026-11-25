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
      expect(migrate(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(migrate(db)).toEqual([]);

      const versions = db.prepare('SELECT version FROM schema_migrations').all();
      expect(versions).toHaveLength(10);
      expect(versions.map((row) => row['version'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

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
        'mcp_servers',
      ]) {
        expect(tables).toContain(table);
      }

      const modelColumns = db
        .prepare('PRAGMA table_info(provider_models)')
        .all()
        .map((row) => row['name']);
      for (const column of [
        'context_window',
        'max_output_tokens',
        'capabilities',
        'reasoning_effort',
        'source',
      ]) {
        expect(modelColumns).toContain(column);
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

  it('keeps mcp servers independent of projects and threads', () => {
    env = createTempEnv();
    const db = openDb(join(env.root, 'tuffcode.db'));
    migrate(db);
    try {
      const now = new Date().toISOString();
      const insert = db.prepare(
        'INSERT INTO mcp_servers (id, label, command, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      );
      insert.run('mcp_one', 'filesystem', 'npx', now, now);
      insert.run('mcp_two', 'github', 'npx', now, now);

      expect(db.prepare('PRAGMA foreign_key_list(mcp_servers)').all()).toEqual([]);

      db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
        'prj_mcp',
        'MCP',
        join(env.root, 'mcp-project'),
        now,
      );
      db.prepare('DELETE FROM projects WHERE id = ?').run('prj_mcp');

      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run('mcp_one');
      const remaining = db
        .prepare('SELECT id, args, env, enabled FROM mcp_servers ORDER BY id')
        .all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toEqual({ id: 'mcp_two', args: '[]', env: '{}', enabled: 1 });
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
