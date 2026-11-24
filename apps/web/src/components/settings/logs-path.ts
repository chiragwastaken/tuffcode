/**
 * The server keeps its database and logs side by side (`<app data>/tuffcode.db`
 * and `<app data>/logs`), so the logs folder can be derived from the database
 * path that `app.health` reports without guessing at platform folders.
 */
export function logsFolderFromDbPath(dbPath: string): string {
  const trimmed = dbPath.replace(/[\\/]+$/, '');
  const match = /^(.*)[\\/][^\\/]+$/.exec(trimmed);
  if (!match) return 'logs';
  const separator = trimmed.includes('\\') ? '\\' : '/';
  return `${match[1]}${separator}logs`;
}
