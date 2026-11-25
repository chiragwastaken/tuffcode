import type { DatabaseSync } from 'node:sqlite';
import {
  PluginComponentsSchema,
  type InstalledPlugin,
  type InstalledPluginSource,
  type PluginKind,
} from '@tuffcode/contracts';
import { asRow, boolean, json, nullableText, text, type SqlRow } from '../rows.js';

export interface MarketplaceRow {
  id: string;
  label: string;
  url: string;
  verified: boolean;
  createdAt: string;
}

export interface PluginsRepo {
  list(): InstalledPlugin[];
  get(id: string): InstalledPlugin | undefined;
  findByName(marketplaceId: string | null, name: string): InstalledPlugin | undefined;
  insert(plugin: InstalledPlugin): InstalledPlugin;
  setEnabled(id: string, enabled: boolean): InstalledPlugin | undefined;
  remove(id: string): void;
  listMarketplaces(): MarketplaceRow[];
  addMarketplace(row: MarketplaceRow): MarketplaceRow;
  removeMarketplace(id: string): void;
}

const PLUGIN_COLUMNS =
  'id, marketplace_id, name, display_name, description, version, kind, enabled, install_path, components, source, installed_at';

const EMPTY_COMPONENTS = { skills: [], commands: [], mcpServers: [], agents: [], hooks: false };

function mapPlugin(row: SqlRow): InstalledPlugin {
  const components = PluginComponentsSchema.safeParse(json(row, 'components'));
  return {
    id: text(row, 'id'),
    marketplaceId: nullableText(row, 'marketplace_id'),
    name: text(row, 'name'),
    displayName: text(row, 'display_name'),
    description: text(row, 'description'),
    version: nullableText(row, 'version'),
    kind: text(row, 'kind') as PluginKind,
    enabled: boolean(row, 'enabled'),
    installPath: text(row, 'install_path'),
    components: components.success ? components.data : { ...EMPTY_COMPONENTS },
    source: text(row, 'source') as InstalledPluginSource,
    installedAt: text(row, 'installed_at'),
  };
}

function mapMarketplace(row: SqlRow): MarketplaceRow {
  return {
    id: text(row, 'id'),
    label: text(row, 'label'),
    url: text(row, 'url'),
    verified: boolean(row, 'verified'),
    createdAt: text(row, 'created_at'),
  };
}

export function createPluginsRepo(db: DatabaseSync): PluginsRepo {
  const selectAll = db.prepare(`SELECT ${PLUGIN_COLUMNS} FROM plugins ORDER BY installed_at ASC, rowid ASC`);
  const selectOne = db.prepare(`SELECT ${PLUGIN_COLUMNS} FROM plugins WHERE id = ?`);
  const selectByName = db.prepare(
    `SELECT ${PLUGIN_COLUMNS} FROM plugins WHERE COALESCE(marketplace_id, '') = ? AND name = ?`,
  );
  const insertRow = db.prepare(
    `INSERT INTO plugins (${PLUGIN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateEnabled = db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?');
  const removeRow = db.prepare('DELETE FROM plugins WHERE id = ?');
  const selectMarketplaces = db.prepare(
    'SELECT id, label, url, verified, created_at FROM plugin_marketplaces ORDER BY created_at ASC, rowid ASC',
  );
  const insertMarketplace = db.prepare(
    'INSERT INTO plugin_marketplaces (id, label, url, verified, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const removeMarketplaceRow = db.prepare('DELETE FROM plugin_marketplaces WHERE id = ?');

  function get(id: string): InstalledPlugin | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapPlugin(asRow(row));
  }

  return {
    list: () => selectAll.all().map((row) => mapPlugin(asRow(row))),
    get,
    findByName: (marketplaceId, name) => {
      const row = selectByName.get(marketplaceId ?? '', name);
      return row === undefined ? undefined : mapPlugin(asRow(row));
    },
    insert: (plugin) => {
      insertRow.run(
        plugin.id,
        plugin.marketplaceId,
        plugin.name,
        plugin.displayName,
        plugin.description,
        plugin.version,
        plugin.kind,
        plugin.enabled ? 1 : 0,
        plugin.installPath,
        JSON.stringify(plugin.components),
        plugin.source,
        plugin.installedAt,
      );
      const created = get(plugin.id);
      if (created === undefined) throw new Error('plugin insert did not persist');
      return created;
    },
    setEnabled: (id, enabled) => {
      updateEnabled.run(enabled ? 1 : 0, id);
      return get(id);
    },
    remove: (id) => {
      removeRow.run(id);
    },
    listMarketplaces: () => selectMarketplaces.all().map((row) => mapMarketplace(asRow(row))),
    addMarketplace: (row) => {
      insertMarketplace.run(row.id, row.label, row.url, row.verified ? 1 : 0, row.createdAt);
      return row;
    },
    removeMarketplace: (id) => {
      removeMarketplaceRow.run(id);
    },
  };
}
