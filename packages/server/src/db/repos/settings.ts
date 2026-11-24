import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_SETTINGS,
  SettingsPatchSchema,
  SettingsSchema,
  type Settings,
  type SettingsPatch,
} from '@tuffcode/contracts';
import { transaction } from '../index.js';
import { asRow, text } from '../rows.js';

export interface SettingsRepo {
  get(): Settings;
  patch(patch: SettingsPatch): Settings;
}

/**
 * Settings live as one `settings` row per key, with the value JSON-encoded. Reads merge
 * stored keys over contract defaults, so an empty table yields `DEFAULT_SETTINGS`.
 */
export function createSettingsRepo(db: DatabaseSync): SettingsRepo {
  const selectAll = db.prepare('SELECT key, value FROM settings');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );

  function get(): Settings {
    const stored: Record<string, unknown> = {};
    for (const raw of selectAll.all()) {
      const row = asRow(raw);
      const key = text(row, 'key');
      try {
        stored[key] = JSON.parse(text(row, 'value')) as unknown;
      } catch {
        throw new Error(`settings row ${key} is not valid JSON`);
      }
    }
    return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...stored });
  }

  return {
    get,
    patch: (patch) => {
      const parsed = SettingsPatchSchema.parse(patch);
      const now = new Date().toISOString();
      transaction(db, () => {
        for (const [key, value] of Object.entries(parsed)) {
          if (value === undefined) continue;
          upsert.run(key, JSON.stringify(value), now);
        }
      });
      return get();
    },
  };
}
