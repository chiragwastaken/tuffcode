import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logsDir } from '@tuffcode/shared';
import { MIGRATIONS } from './db/index.js';
import type { Repos } from './db/repos/index.js';
import type { RpcHandler, RpcHandlers } from './rpc.js';
import type { Runner } from './runner/runner.js';

export interface WarningLog {
  push(message: string): void;
  list(): string[];
}

/** Bounded in-memory log of server warnings, surfaced by diagnostics export. */
export function createWarningLog(limit = 50): WarningLog {
  const messages: string[] = [];
  return {
    push: (message) => {
      messages.push(message);
      if (messages.length > limit) messages.splice(0, messages.length - limit);
    },
    list: () => [...messages],
  };
}

export interface DiagnosticsInput {
  version: string;
  startedAt: number;
  dbPath: string;
  repos: Repos;
  runner: Pick<Runner, 'listActive'>;
  warnings?: () => readonly string[];
  secretBridgeAvailable: boolean;
}

function threadCounts(repos: Repos): { total: number; byStatus: Record<string, number> } {
  const threads = repos.threads.list();
  const byStatus: Record<string, number> = {};
  for (const thread of threads) {
    byStatus[thread.status] = (byStatus[thread.status] ?? 0) + 1;
  }
  return { total: threads.length, byStatus };
}

/**
 * Writes one JSON snapshot for bug reports. No secret values, prompts, message text,
 * file contents, environment values, or user paths beyond the database and log
 * locations are included.
 */
export function exportDiagnostics(input: DiagnosticsInput): { path: string } {
  const schemaVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
  const threads = threadCounts(input.repos);
  const events = input.repos.threads
    .list()
    .reduce((total, thread) => total + input.repos.events.count(thread.id), 0);
  const payload = {
    generatedAt: new Date().toISOString(),
    schemaVersion,
    appVersion: input.version,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    uptimeMs: Date.now() - input.startedAt,
    dbPath: input.dbPath,
    logsDir: logsDir(),
    settings: input.repos.settings.get(),
    providers: input.repos.providers.list(),
    secretBridgeAvailable: input.secretBridgeAvailable,
    counts: {
      projects: input.repos.projects.list().length,
      threads,
      events,
    },
    activeRuns: input.runner.listActive(),
    warnings: [...(input.warnings?.() ?? [])],
  };

  const dir = logsDir();
  mkdirSync(dir, { recursive: true });
  const stamp = payload.generatedAt.replace(/[:.]/g, '-');
  const file = join(dir, `diagnostics-${stamp}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  return { path: file };
}

/** RPC handler map for `diagnostics.export`. */
export function createDiagnosticsHandlers(input: DiagnosticsInput): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('diagnostics.export', () => exportDiagnostics(input));
  return handlers;
}
