import type { DatabaseSync } from 'node:sqlite';
import type { McpAuthMode, McpServer, McpTransport } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { asRow, boolean, json, nullableText, text, type SqlRow } from '../rows.js';

export interface UpsertMcpServerInput {
  id?: string;
  label: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  url?: string | null;
  /** How the connector authenticates; defaults to bearer when a secretRef is set. */
  authMode?: McpAuthMode;
  /** Header that carries the credential; null falls back to Authorization. */
  authHeader?: string | null;
  /** Secret-bridge reference for the credential; `null` clears it. */
  secretRef?: string | null;
  pluginId?: string | null;
  enabled?: boolean;
}

export interface McpRepo {
  list(): McpServer[];
  get(id: string): McpServer | undefined;
  /** The secret-bridge reference behind `hasSecret`; it never leaves the server. */
  secretRef(id: string): string | null;
  listByPlugin(pluginId: string): McpServer[];
  upsert(input: UpsertMcpServerInput): McpServer;
  remove(id: string): void;
  setEnabledByPlugin(pluginId: string, enabled: boolean): number;
}

const MCP_COLUMNS =
  'id, label, transport, command, args, env, cwd, url, auth_mode, auth_header, secret_ref, plugin_id, enabled, created_at, updated_at';

const AUTH_MODES: readonly McpAuthMode[] = ['none', 'bearer', 'oauth'];

function authModeOf(row: SqlRow): McpAuthMode {
  const value = nullableText(row, 'auth_mode');
  return AUTH_MODES.find((mode) => mode === value) ?? 'none';
}

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
    transport: text(row, 'transport') === 'http' ? 'http' : 'stdio',
    command: text(row, 'command'),
    args: stringArray(row, 'args'),
    env: stringRecord(row, 'env'),
    cwd: nullableText(row, 'cwd'),
    url: nullableText(row, 'url'),
    authMode: authModeOf(row),
    authHeader: nullableText(row, 'auth_header') ?? 'Authorization',
    hasSecret: nullableText(row, 'secret_ref') !== null,
    pluginId: nullableText(row, 'plugin_id'),
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
    'INSERT INTO mcp_servers (id, label, transport, command, args, env, cwd, url, auth_mode, auth_header, secret_ref, plugin_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE mcp_servers SET label = ?, transport = ?, command = ?, args = ?, env = ?, cwd = ?, url = ?, auth_mode = ?, auth_header = ?, secret_ref = ?, enabled = ?, updated_at = ? WHERE id = ?',
  );
  const removeRow = db.prepare('DELETE FROM mcp_servers WHERE id = ?');
  const selectByPlugin = db.prepare(
    `SELECT ${MCP_COLUMNS} FROM mcp_servers WHERE plugin_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const selectSecret = db.prepare('SELECT secret_ref FROM mcp_servers WHERE id = ?');
  const updateByPlugin = db.prepare(
    'UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE plugin_id = ?',
  );

  function get(id: string): McpServer | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapMcpServer(asRow(row));
  }

  return {
    list: () => selectAll.all().map((row) => mapMcpServer(asRow(row))),
    get,
    secretRef: (id) => {
      const row = selectSecret.get(id);
      return row === undefined ? null : nullableText(asRow(row), 'secret_ref');
    },
    listByPlugin: (pluginId) => selectByPlugin.all(pluginId).map((row) => mapMcpServer(asRow(row))),
    setEnabledByPlugin: (pluginId, enabled) =>
      Number(updateByPlugin.run(enabled ? 1 : 0, new Date().toISOString(), pluginId).changes ?? 0),
    upsert: (input) => {
      const existing = input.id === undefined ? undefined : get(input.id);
      const now = new Date().toISOString();
      const args = JSON.stringify(input.args ?? existing?.args ?? []);
      const env = JSON.stringify(input.env ?? existing?.env ?? {});
      const transport = input.transport ?? existing?.transport ?? 'stdio';
      const command = input.command ?? existing?.command ?? '';
      const authMode =
        input.authMode ??
        existing?.authMode ??
        ((input.secretRef ?? null) !== null ? 'bearer' : 'none');
      const authHeader = input.authHeader ?? existing?.authHeader ?? 'Authorization';
      if (existing === undefined) {
        const id = input.id ?? newId('mcp');
        insert.run(
          id,
          input.label,
          transport,
          command,
          args,
          env,
          input.cwd ?? null,
          input.url ?? null,
          authMode,
          authHeader,
          input.secretRef ?? null,
          input.pluginId ?? null,
          input.enabled === false ? 0 : 1,
          now,
          now,
        );
        const created = get(id);
        if (created === undefined) throw new Error('mcp server insert did not persist');
        return created;
      }
      const currentSecret = nullableText(asRow(selectSecret.get(existing.id)), 'secret_ref');
      update.run(
        input.label,
        transport,
        command,
        args,
        env,
        input.cwd === undefined ? existing.cwd : input.cwd,
        input.url === undefined ? existing.url : input.url,
        authMode,
        authHeader,
        input.secretRef === undefined ? currentSecret : input.secretRef,
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
