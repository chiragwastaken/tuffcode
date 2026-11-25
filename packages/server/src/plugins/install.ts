import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, rm, copyFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { isInside } from '@tuffcode/shared';
import type { RawEntry } from './catalog.js';

const execFileAsync = promisify(execFile);

/**
 * Getting plugin files onto disk. Sources come from a catalog entry (a path inside the
 * marketplace repo, a git subdirectory, or a whole git repo) and are fetched with a
 * shallow, sparse git clone; uploads are archives extracted with the system `tar`
 * (bsdtar, which ships with Windows 10 and later and reads zip). Both paths copy into
 * the install dir with the same guards: no symlinks, nothing outside the tree, and a
 * size and file-count cap.
 */
export const INSTALL_LIMITS = { bytes: 50 * 1024 * 1024, files: 5000 } as const;
export const GIT_TIMEOUT_MS = 120_000;

const ALLOWED_GIT_HOSTS = new Set(['github.com', 'gitlab.com']);
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export interface ResolvedSource {
  /** https clone URL on an allowed host. */
  repoUrl: string;
  /** Directory inside the repo holding the plugin; '' for the repo root. */
  subdir: string;
  /** Commit, tag or branch to check out; null for the default branch. */
  ref: string | null;
  /** For skill bundles: only these repo paths are copied, each into skills/<name>. */
  skillPaths: string[] | null;
}

function cleanSubdir(path: string | undefined): string {
  const normalized = (path ?? '').replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/+$/, '');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('the plugin path leaves its repository');
  }
  return normalized;
}

export function validateGitUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('the plugin source is not a valid URL');
  }
  if (url.protocol !== 'https:' || !ALLOWED_GIT_HOSTS.has(url.hostname)) {
    throw new Error('plugins install only from https GitHub or GitLab repositories');
  }
  if (url.username.length > 0 || url.password.length > 0) throw new Error('the plugin source has credentials');
  return url.toString().replace(/\/+$/, '');
}

function cleanRef(ref: string | undefined): string | null {
  if (ref === undefined || ref.trim().length === 0) return null;
  if (!SAFE_REF.test(ref) || ref.includes('..')) throw new Error('the plugin source names an unsafe ref');
  return ref;
}

/** Turns a catalog entry's source into something git can fetch, or explains why not. */
export function resolveSource(entry: RawEntry, marketplaceRepo: string | null): ResolvedSource {
  const source = entry.source;
  const bundle = entry.skills !== undefined && entry.skills.length > 0 ? entry.skills.map(cleanSubdir) : null;
  if (typeof source === 'string') {
    if (marketplaceRepo === null) throw new Error('this marketplace does not name its repository');
    const subdir = cleanSubdir(source);
    return {
      repoUrl: validateGitUrl(`https://github.com/${marketplaceRepo}.git`),
      subdir,
      ref: null,
      skillPaths: bundle?.map((path) => (subdir.length === 0 ? path : `${subdir}/${path}`)) ?? null,
    };
  }
  const ref = cleanRef(source.sha ?? source.ref);
  switch (source.source) {
    case 'git-subdir':
      if (source.url === undefined) throw new Error('the plugin source has no url');
      return { repoUrl: validateGitUrl(source.url), subdir: cleanSubdir(source.path), ref, skillPaths: null };
    case 'url':
    case 'git':
      if (source.url === undefined) throw new Error('the plugin source has no url');
      return { repoUrl: validateGitUrl(source.url), subdir: cleanSubdir(source.path), ref, skillPaths: null };
    case 'github':
      if (source.repo === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo)) {
        throw new Error('the plugin source names no repository');
      }
      return {
        repoUrl: validateGitUrl(`https://github.com/${source.repo}.git`),
        subdir: cleanSubdir(source.path),
        ref,
        skillPaths: null,
      };
    default:
      throw new Error(`plugin sources of type "${source.source}" are not supported yet`);
  }
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

export function defaultGit(): GitRunner {
  return async (args, cwd) => {
    const { stdout } = await execFileAsync('git', ['-c', 'core.longpaths=true', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
    return stdout;
  };
}

/**
 * Shallow, sparse clone of only the paths the plugin needs into `workDir/repo`.
 * `cloneUrl` lets tests point the validated URL at a local fixture repository.
 */
export async function fetchSource(
  source: ResolvedSource,
  workDir: string,
  git: GitRunner,
  cloneUrl: (repoUrl: string) => string = (url) => url,
): Promise<string> {
  const repo = join(workDir, 'repo');
  const paths = source.skillPaths ?? (source.subdir.length > 0 ? [source.subdir] : []);
  const sparse = paths.length > 0;
  await git(
    ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', ...(sparse ? ['--sparse'] : []), cloneUrl(source.repoUrl), repo],
    workDir,
  );
  if (sparse) await git(['sparse-checkout', 'set', '--no-cone', ...paths.map((path) => `/${path}/`)], repo);
  if (source.ref !== null) {
    await git(['fetch', '--depth', '1', '--filter=blob:none', 'origin', source.ref], repo);
    await git(['checkout', '--quiet', 'FETCH_HEAD'], repo);
  } else {
    await git(['checkout', '--quiet'], repo);
  }
  return repo;
}

interface CopyBudget {
  bytes: number;
  files: number;
}

/** Copies a tree, refusing symlinks and anything that would exceed the install limits. */
export async function copyTree(from: string, to: string, budget: CopyBudget = { bytes: 0, files: 0 }): Promise<CopyBudget> {
  const root = await realpath(from);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`plugins may not contain symlinks (${entry.name})`);
    if (!isInside(root, await realpath(source))) throw new Error('a plugin file escapes its directory');
    if (info.isDirectory()) {
      await copyTree(source, target, budget);
    } else if (info.isFile()) {
      budget.bytes += info.size;
      budget.files += 1;
      if (budget.bytes > INSTALL_LIMITS.bytes) throw new Error('the plugin is larger than 50 MB');
      if (budget.files > INSTALL_LIMITS.files) throw new Error('the plugin has more than 5000 files');
      await copyFile(source, target);
    }
  }
  return budget;
}

/** Installs fetched files: a whole plugin directory, or each bundled skill into skills/<name>. */
export async function placeSource(repo: string, source: ResolvedSource, installDir: string): Promise<void> {
  if (source.skillPaths !== null) {
    const budget = { bytes: 0, files: 0 };
    for (const path of source.skillPaths) {
      const from = resolve(repo, path);
      if (!isInside(repo, from)) throw new Error('a skill path leaves the repository');
      await copyTree(from, join(installDir, 'skills', basename(path)), budget);
    }
    return;
  }
  const from = resolve(repo, source.subdir);
  if (!isInside(repo, from)) throw new Error('the plugin path leaves the repository');
  await copyTree(from, installDir);
}

/**
 * Archive entry names must be relative and stay inside the target; checked from the
 * listing before anything is written, so a zip-slip archive never touches disk.
 */
export function unsafeArchiveEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  );
}

export type ArchiveTool = (args: readonly string[], cwd: string) => Promise<string>;

export function defaultTar(): ArchiveTool {
  // System32 bsdtar on Windows; a plain `tar` elsewhere.
  const command = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return async (args, cwd) => {
    const { stdout } = await execFileAsync(command, [...args], {
      cwd,
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };
}

/** Lists, checks, then extracts an archive into a fresh directory under `workDir`. */
export async function extractArchive(archive: string, workDir: string, tar: ArchiveTool): Promise<string> {
  const listing = await tar(['-tf', archive], workDir);
  const names = listing.split(/\r?\n/).filter((line) => line.length > 0);
  if (names.length === 0) throw new Error('the archive is empty');
  if (names.length > INSTALL_LIMITS.files) throw new Error('the archive has more than 5000 files');
  const bad = names.find(unsafeArchiveEntry);
  if (bad !== undefined) throw new Error(`the archive has an unsafe path: ${bad}`);
  const target = join(workDir, 'extracted');
  await mkdir(target, { recursive: true });
  await tar(['-xf', archive, '-C', target], workDir);
  return target;
}

/** The single top-level directory of an extracted archive, or the extraction root. */
export async function archiveRoot(extracted: string): Promise<string> {
  const entries = (await readdir(extracted, { withFileTypes: true })).filter((entry) => entry.name !== '__MACOSX');
  if (entries.length === 1 && entries[0]?.isDirectory() === true) return join(extracted, entries[0].name);
  return extracted;
}

export async function makeWorkDir(parent: string): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'tmp-'));
}

/** Removes a directory only when it sits strictly inside `root`. */
export async function removeInside(root: string, target: string): Promise<void> {
  const rel = relative(resolve(root), resolve(target));
  if (rel.length === 0 || rel.startsWith('..') || rel.startsWith(sep) || resolve(target) === dirname(resolve(root))) {
    throw new Error('refusing to delete outside the plugins directory');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
