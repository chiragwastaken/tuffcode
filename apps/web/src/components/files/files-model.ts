/**
 * The Files explorer tree, built once from the flat path list `files.tree` returns.
 * Rows are flattened for virtualization: only expanded directories contribute
 * children, and a filter shows every match with its ancestors expanded.
 */
export interface FileNode {
  name: string;
  /** Repo-relative path with forward slashes. */
  path: string;
  kind: 'dir' | 'file';
  children: FileNode[];
}

export interface FileRow {
  node: FileNode;
  depth: number;
  expanded: boolean;
}

export function buildFileTree(paths: readonly string[]): FileNode {
  const root: FileNode = { name: '', path: '', kind: 'dir', children: [] };
  const dirs = new Map<string, FileNode>([['', root]]);
  for (const raw of paths) {
    const parts = raw.replace(/\\/g, '/').split('/').filter((part) => part.length > 0);
    let parent = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index] ?? '';
      const path = parts.slice(0, index + 1).join('/');
      const last = index === parts.length - 1;
      if (last) {
        parent.children.push({ name, path, kind: 'file', children: [] });
        break;
      }
      let dir = dirs.get(path);
      if (dir === undefined) {
        dir = { name, path, kind: 'dir', children: [] };
        dirs.set(path, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
  }
  sortTree(root);
  return root;
}

function sortTree(node: FileNode): void {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
  for (const child of node.children) if (child.kind === 'dir') sortTree(child);
}

/**
 * A plain query matches a substring of the path. A query starting with `?` matches
 * its characters in order anywhere in the path, the quick fuzzy mode of the video.
 */
export function matchesFileQuery(path: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  const target = path.toLowerCase();
  if (!trimmed.startsWith('?')) return target.includes(trimmed);
  const needle = trimmed.slice(1).replace(/\s+/g, '');
  let at = 0;
  for (const char of needle) {
    at = target.indexOf(char, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

export const FILTER_RESULT_LIMIT = 2000;

export function visibleRows(
  root: FileNode,
  expanded: ReadonlySet<string>,
  query: string,
): FileRow[] {
  const rows: FileRow[] = [];
  if (query.trim().length > 0) {
    const keep = new Set<string>();
    let matches = 0;
    const mark = (node: FileNode): boolean => {
      if (matches >= FILTER_RESULT_LIMIT) return false;
      if (node.kind === 'file') {
        if (!matchesFileQuery(node.path, query)) return false;
        matches += 1;
        keep.add(node.path);
        return true;
      }
      let any = false;
      for (const child of node.children) any = mark(child) || any;
      if (any) keep.add(node.path);
      return any;
    };
    mark(root);
    const walk = (node: FileNode, depth: number): void => {
      for (const child of node.children) {
        if (!keep.has(child.path)) continue;
        rows.push({ node: child, depth, expanded: child.kind === 'dir' });
        if (child.kind === 'dir') walk(child, depth + 1);
      }
    };
    walk(root, 0);
    return rows;
  }
  const walk = (node: FileNode, depth: number): void => {
    for (const child of node.children) {
      const open = child.kind === 'dir' && expanded.has(child.path);
      rows.push({ node: child, depth, expanded: open });
      if (open) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

export function toggleExpanded(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
