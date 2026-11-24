import type { DatabaseSync } from 'node:sqlite';
import type { BrainEntry, BrainKind } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { transaction } from '../index.js';
import { asRow, boolean, integer, nullableText, real, text, type SqlRow } from '../rows.js';

export interface BrainListOptions {
  kind?: BrainKind;
  projectId?: string;
  /** Include global (`project_id IS NULL`) rows alongside the project's own. */
  includeGlobal?: boolean;
  query?: string;
  limit?: number;
  /** Inspector-only: include entries toggled inactive. Selection never does. */
  includeInactive?: boolean;
}

export interface UpsertBrainInput {
  id?: string;
  kind: BrainKind;
  scope: string;
  projectId?: string | null;
  text: string;
  tags?: string;
  appliesTo?: string | null;
  importance?: number;
  sourceQuote?: string | null;
  active?: boolean;
}

/** A typed relation between two brain entries, stored in `brain_edges`. */
export interface BrainEdge {
  from: string;
  to: string;
  relation: string;
}

export interface UpsertBrainEdgeInput {
  from: string;
  to: string;
  relation: string;
}

export interface BrainRepo {
  list(options?: BrainListOptions): BrainEntry[];
  get(id: string): BrainEntry | undefined;
  upsert(input: UpsertBrainInput): BrainEntry;
  remove(id: string): void;
  touch(ids: string[], at: string): void;
  listEdges(): BrainEdge[];
  upsertEdge(input: UpsertBrainEdgeInput): BrainEdge;
}

const BRAIN_COLUMNS =
  'id, kind, scope, project_id, text, tags, applies_to, importance, use_count, active, source_quote, created_at, updated_at, last_used_at';

function mapBrainEntry(row: SqlRow): BrainEntry {
  return {
    id: text(row, 'id'),
    kind: text(row, 'kind') as BrainKind,
    scope: text(row, 'scope'),
    projectId: nullableText(row, 'project_id'),
    text: text(row, 'text'),
    tags: text(row, 'tags'),
    appliesTo: nullableText(row, 'applies_to'),
    importance: real(row, 'importance'),
    useCount: integer(row, 'use_count'),
    active: boolean(row, 'active'),
    sourceQuote: nullableText(row, 'source_quote'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    lastUsedAt: nullableText(row, 'last_used_at'),
  };
}

function mapBrainEdge(row: SqlRow): BrainEdge {
  return {
    from: text(row, 'from_id'),
    to: text(row, 'to_id'),
    relation: text(row, 'relation'),
  };
}

/**
 * Turns free text into an FTS5 query of quoted, lowercased terms joined with OR.
 * Only letters, numbers and underscores survive, so no FTS syntax can leak through.
 */
export function toFtsQuery(input: string): string | null {
  const terms = [...new Set(input.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(' OR ');
}

export function createBrainRepo(db: DatabaseSync): BrainRepo {
  const selectOne = db.prepare(`SELECT ${BRAIN_COLUMNS} FROM brain_entries WHERE id = ?`);
  const selectPlain = db.prepare(
    `SELECT ${BRAIN_COLUMNS} FROM brain_entries
     WHERE (? IS NULL OR kind = ?)
       AND (? IS NULL OR project_id = ? OR (? = 1 AND project_id IS NULL))
       AND (? = 1 OR active = 1)
     ORDER BY importance DESC, updated_at DESC
     LIMIT ?`,
  );
  const selectFts = db.prepare(
    `SELECT e.id, e.kind, e.scope, e.project_id, e.text, e.tags, e.applies_to, e.importance,
            e.use_count, e.active, e.source_quote, e.created_at, e.updated_at, e.last_used_at
     FROM brain_entries e
     JOIN brain_fts f ON f.rowid = e.rowid
     WHERE brain_fts MATCH ?
       AND (? IS NULL OR e.kind = ?)
       AND (? IS NULL OR e.project_id = ? OR (? = 1 AND e.project_id IS NULL))
       AND (? = 1 OR e.active = 1)
     ORDER BY rank
     LIMIT ?`,
  );
  const insert = db.prepare(
    `INSERT INTO brain_entries (id, kind, scope, project_id, text, tags, applies_to, importance, use_count, active, source_quote, created_at, updated_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       scope = excluded.scope,
       project_id = CASE WHEN ? = 1 THEN brain_entries.project_id ELSE excluded.project_id END,
       text = excluded.text,
       tags = excluded.tags,
       applies_to = excluded.applies_to,
       importance = excluded.importance,
       active = excluded.active,
       source_quote = CASE WHEN ? = 1 THEN brain_entries.source_quote ELSE excluded.source_quote END,
       updated_at = excluded.updated_at`,
  );
  const removeRow = db.prepare('DELETE FROM brain_entries WHERE id = ?');
  const touchRow = db.prepare(
    'UPDATE brain_entries SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
  );
  const selectEdges = db.prepare(
    'SELECT from_id, to_id, relation FROM brain_edges ORDER BY from_id, to_id, relation',
  );
  const insertEdge = db.prepare(
    `INSERT INTO brain_edges (from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  function get(id: string): BrainEntry | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapBrainEntry(asRow(row));
  }

  return {
    list: (options = {}) => {
      const limit = Math.min(300, Math.max(1, Math.floor(options.limit ?? 50)));
      const includeGlobal = options.includeGlobal === true ? 1 : 0;
      const ftsQuery = options.query === undefined ? null : toFtsQuery(options.query);
      if (ftsQuery !== null) {
        return selectFts
          .all(
            ftsQuery,
            options.kind ?? null,
            options.kind ?? null,
            options.projectId ?? null,
            options.projectId ?? null,
            includeGlobal,
            options.includeInactive === true ? 1 : 0,
            limit,
          )
          .map((row) => mapBrainEntry(asRow(row)));
      }
      return selectPlain
        .all(
          options.kind ?? null,
          options.kind ?? null,
          options.projectId ?? null,
          options.projectId ?? null,
          includeGlobal,
          options.includeInactive === true ? 1 : 0,
          limit,
        )
        .map((row) => mapBrainEntry(asRow(row)));
    },
    get,
    upsert: (input) => {
      const now = new Date().toISOString();
      const id = input.id ?? newId('brn');
      insert.run(
        id,
        input.kind,
        input.scope,
        input.projectId ?? null,
        input.text,
        input.tags ?? '',
        input.appliesTo ?? null,
        Math.min(1, Math.max(0, input.importance ?? 0.5)),
        input.active === false ? 0 : 1,
        input.sourceQuote ?? null,
        now,
        now,
        input.projectId === undefined ? 1 : 0,
        input.sourceQuote === undefined ? 1 : 0,
      );
      const entry = get(id);
      if (entry === undefined) throw new Error('brain entry insert did not persist');
      return entry;
    },
    remove: (id) => {
      removeRow.run(id);
    },
    touch: (ids, at) =>
      transaction(db, () => {
        for (const id of ids) touchRow.run(at, id);
      }),
    listEdges: () => selectEdges.all().map((row) => mapBrainEdge(asRow(row))),
    upsertEdge: (input) => {
      const relation = input.relation.trim();
      if (relation.length === 0) throw new Error('brain edge relation must not be empty');
      insertEdge.run(input.from, input.to, relation, new Date().toISOString());
      return { from: input.from, to: input.to, relation };
    },
  };
}
