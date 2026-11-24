import type { DatabaseSync } from 'node:sqlite';
import {
  ProviderConfigSchema,
  type Model,
  type ProviderKind,
  type ProviderView,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import type { z } from 'zod';
import { transaction } from '../index.js';
import { asRow, boolean, json, nullableInteger, nullableText, text, type SqlRow } from '../rows.js';

/**
 * The entity config value, derived from its schema. `ProviderConfig` itself is
 * ambiguous in the contracts barrel: adapters.ts exports a provider descriptor under
 * the same name, so importing that name yields the wrong shape.
 */
export type ProviderConfigValue = z.infer<typeof ProviderConfigSchema>;

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  label: string;
  config: ProviderConfigValue;
  secretRef: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderInput {
  id?: string;
  kind: ProviderKind;
  label: string;
  config: ProviderConfigValue;
  secretRef?: string | null;
  enabled?: boolean;
}

export interface ReplaceModelInput {
  modelId: string;
  label: string;
  contextWindow: number | null;
  isDefault: boolean;
}

export interface ProvidersRepo {
  list(): ProviderView[];
  get(id: string): ProviderRecord | undefined;
  upsert(input: UpsertProviderInput): ProviderView;
  remove(id: string): void;
  listModels(providerId: string): Model[];
  replaceModels(providerId: string, models: ReplaceModelInput[]): Model[];
}

const PROVIDER_COLUMNS = 'id, kind, label, config, secret_ref, enabled, created_at, updated_at';

function mapRecord(row: SqlRow): ProviderRecord {
  return {
    id: text(row, 'id'),
    kind: text(row, 'kind') as ProviderKind,
    label: text(row, 'label'),
    config: ProviderConfigSchema.parse(json(row, 'config')),
    secretRef: nullableText(row, 'secret_ref'),
    enabled: boolean(row, 'enabled'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function toProviderView(record: ProviderRecord): ProviderView {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    config: record.config,
    enabled: record.enabled,
    hasSecret: record.secretRef !== null && record.secretRef.length > 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createProvidersRepo(db: DatabaseSync): ProvidersRepo {
  const selectAll = db.prepare(
    `SELECT ${PROVIDER_COLUMNS} FROM providers ORDER BY created_at ASC, rowid ASC`,
  );
  const selectOne = db.prepare(`SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id = ?`);
  const insert = db.prepare(
    'INSERT INTO providers (id, kind, label, config, secret_ref, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE providers SET kind = ?, label = ?, config = ?, enabled = ?, secret_ref = COALESCE(?, secret_ref), updated_at = ? WHERE id = ?',
  );
  const removeRow = db.prepare('DELETE FROM providers WHERE id = ?');
  const selectModels = db.prepare(
    'SELECT provider_id, model_id, label, context_window, is_default FROM provider_models WHERE provider_id = ? ORDER BY is_default DESC, label ASC',
  );
  const deleteModels = db.prepare('DELETE FROM provider_models WHERE provider_id = ?');
  const insertModel = db.prepare(
    'INSERT INTO provider_models (provider_id, model_id, label, context_window, is_default) VALUES (?, ?, ?, ?, ?)',
  );

  function get(id: string): ProviderRecord | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapRecord(asRow(row));
  }

  function listModels(providerId: string): Model[] {
    return selectModels.all(providerId).map((row) => {
      const record = asRow(row);
      return {
        providerId: text(record, 'provider_id'),
        modelId: text(record, 'model_id'),
        label: text(record, 'label'),
        contextWindow: nullableInteger(record, 'context_window'),
        isDefault: boolean(record, 'is_default'),
      };
    });
  }

  return {
    list: () => selectAll.all().map((row) => toProviderView(mapRecord(asRow(row)))),
    get,
    upsert: (input) => {
      const existing = input.id === undefined ? undefined : get(input.id);
      const now = new Date().toISOString();
      if (existing === undefined) {
        const id = input.id ?? newId('prv');
        insert.run(
          id,
          input.kind,
          input.label,
          JSON.stringify(input.config),
          input.secretRef ?? null,
          input.enabled === false ? 0 : 1,
          now,
          now,
        );
        const created = get(id);
        if (created === undefined) throw new Error('provider insert did not persist');
        return toProviderView(created);
      }
      update.run(
        input.kind,
        input.label,
        JSON.stringify(input.config),
        input.enabled === false ? 0 : 1,
        input.secretRef ?? null,
        now,
        existing.id,
      );
      const updated = get(existing.id);
      if (updated === undefined) throw new Error('provider update did not persist');
      return toProviderView(updated);
    },
    remove: (id) => {
      removeRow.run(id);
    },
    listModels,
    replaceModels: (providerId, models) =>
      transaction(db, () => {
        deleteModels.run(providerId);
        for (const model of models) {
          insertModel.run(
            providerId,
            model.modelId,
            model.label,
            model.contextWindow,
            model.isDefault ? 1 : 0,
          );
        }
        return listModels(providerId);
      }),
  };
}
