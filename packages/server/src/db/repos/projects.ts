import type { DatabaseSync } from 'node:sqlite';
import type { Project } from '@tuffcode/contracts';
import { asRow, nullableText, text, type SqlRow } from '../rows.js';

export interface AddProjectInput {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  createdAt: string;
}

export interface ProjectMeta {
  name: string;
  defaultBranch: string;
}

export interface ProjectsRepo {
  list(): Project[];
  get(id: string): Project | undefined;
  findByPath(path: string): Project | undefined;
  add(input: AddProjectInput): Project;
  remove(id: string): void;
  touch(id: string, at: string): void;
  updateMeta(id: string, meta: ProjectMeta, at: string): void;
}

export function mapProject(row: SqlRow): Project {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    path: text(row, 'path'),
    defaultBranch: text(row, 'default_branch'),
    createdAt: text(row, 'created_at'),
    lastOpenedAt: nullableText(row, 'last_opened_at'),
  };
}

export function createProjectsRepo(db: DatabaseSync): ProjectsRepo {
  const selectAll = db.prepare(
    'SELECT id, name, path, default_branch, created_at, last_opened_at FROM projects ORDER BY last_opened_at DESC, created_at ASC',
  );
  const selectOne = db.prepare(
    'SELECT id, name, path, default_branch, created_at, last_opened_at FROM projects WHERE id = ?',
  );
  const selectByPath = db.prepare(
    process.platform === 'win32'
      ? 'SELECT id, name, path, default_branch, created_at, last_opened_at FROM projects WHERE path = ? COLLATE NOCASE'
      : 'SELECT id, name, path, default_branch, created_at, last_opened_at FROM projects WHERE path = ?',
  );
  const insert = db.prepare(
    'INSERT INTO projects (id, name, path, default_branch, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const removeRow = db.prepare('DELETE FROM projects WHERE id = ?');
  const touchRow = db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?');
  const updateMetaRow = db.prepare(
    'UPDATE projects SET name = ?, default_branch = ?, last_opened_at = ? WHERE id = ?',
  );

  function get(id: string): Project | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapProject(asRow(row));
  }

  return {
    list: () => selectAll.all().map((row) => mapProject(asRow(row))),
    get,
    findByPath: (path) => {
      const row = selectByPath.get(path);
      return row === undefined ? undefined : mapProject(asRow(row));
    },
    add: (input) => {
      insert.run(
        input.id,
        input.name,
        input.path,
        input.defaultBranch,
        input.createdAt,
        input.createdAt,
      );
      const created = get(input.id);
      if (created === undefined) throw new Error('project insert did not persist');
      return created;
    },
    remove: (id) => {
      removeRow.run(id);
    },
    touch: (id, at) => {
      touchRow.run(at, id);
    },
    updateMeta: (id, meta, at) => {
      updateMetaRow.run(meta.name, meta.defaultBranch, at, id);
    },
  };
}
