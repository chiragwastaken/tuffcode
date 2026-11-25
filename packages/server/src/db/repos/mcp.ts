import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { asRow, boolean, json, nullableText, text, type SqlRow } from '../rows.js';

export interface UpsertMcpServerInput {
  id?: string;
  label: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  enabled?: boolean;
}

export interface McpRepo {
  list(): McpServer[];
  get(id: string): McpServer | undefined;
  upsert(input: UpsertMcpServerInput): McpServer;
  remove(id: string): void;
}

const MCP_COLUMNS = 'id, label, command, args, env, cwd, enabled, created_at, updated_at';

function stringArray(row: SqlRow, column: string): string[] {
  const decoded = json(row, column);
  if (!Array.isArray(decoded) || decoded.some((entry) => typeof entry !== 'string')) {
    throw new Error(`column ${column} is not a string array`);
  }
  return decoded;
}

function stringRecord(row: SqlRow, column: string): Record<string, string> {
  const decoded = json(row, column);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error(`column ${column} is not an object`);
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value !== 'string') throw new Error(`column ${column} has a non-string value`);
    record[key] = value;
  }
  return record;
}

function mapMcpServer(row: SqlRow): McpServer {
  return {
    id: text(row, 'id'),
    label: text(row, 'label'),
    command: text(row, 'command'),
    args: stringArray(row, 'args'),
    env: stringRecord(row, 'env'),
    cwd: nullableText(row, 'cwd'),
    enabled: boolean(row, 'enabled'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function createMcpRepo(db: DatabaseSync): McpRepo {
  const selectAll = db.prepare(
    `SELECT ${MCP_COLUMNS} FROM mcp_servers ORDER BY created_at ASC, rowid ASC`,
  );
  const selectOne = db.prepare(`SELECT ${MCP_COLUMNS} FROM mcp_servers WHERE id = ?`);
  const insert = db.prepare(
    'INSERT INTO mcp_servers (id, label, command, args, env, cwd, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE mcp_servers SET label = ?, command = ?, args = ?, env = ?, cwd = ?, enabled = ?, updated_at = ? WHERE id = ?',
  );
  const removeRow = db.prepare('DELETE FROM mcp_servers WHERE id = ?');

  function get(id: string): McpServer | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapMcpServer(asRow(row));
  }

  return {
    list: () => selectAll.all().map((row) => mapMcpServer(asRow(row))),
    get,
    upsert: (input) => {
      const existing = input.id === undefined ? undefined : get(input.id);
      const now = new Date().toISOString();
      const args = JSON.stringify(input.args ?? existing?.args ?? []);
      const env = JSON.stringify(input.env ?? existing?.env ?? {});
      if (existing === undefined) {
        const id = input.id ?? newId('mcp');
        insert.run(
          id,
          input.label,
          input.command,
          args,
          env,
          input.cwd ?? null,
          input.enabled === false ? 0 : 1,
          now,
          now,
        );
        const created = get(id);
        if (created === undefined) throw new Error('mcp server insert did not persist');
        return created;
      }
      update.run(
        input.label,
        input.command,
        args,
        env,
        input.cwd === undefined ? existing.cwd : input.cwd,
        input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0,
        now,
        existing.id,
      );
      const updated = get(existing.id);
      if (updated === undefined) throw new Error('mcp server update did not persist');
      return updated;
    },
    remove: (id) => {
      removeRow.run(id);
    },
  };
}
