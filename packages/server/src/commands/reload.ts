import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { McpService } from '../mcp/service.js';
import { discoverSkills } from '../skills/discover.js';
import { pluginCommandDirs, pluginSkillRoots } from '../skills/roots.js';
import { listCommands } from './discover.js';

/**
 * Live configuration reload, D50. Every section is independent: one failure is
 * reported in the summary text and never stops the others, and nothing here restarts
 * the server, disposes a session, or kills a terminal.
 */
export interface ReloadConfigDeps {
  repos: Repos;
  bus?: EventBus;
  /** Drops the MCP tool cache and re-reads connector credentials. */
  mcp?: Pick<McpService, 'invalidate'>;
  onWarning?: (message: string) => void;
}

export interface ReloadCounts {
  providers: number;
  mcpServers: number;
  skills: number;
  commands: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Re-reads settings, providers and their stored model rows, connector credentials and
 * tools, skills, commands and plugin state, then broadcasts what changed. Provider
 * discovery is not re-run: the model rows come from the database. Adapter sessions are
 * keyed by provider and model, so the next turn picks up a new provider or model on its
 * own; an existing session keeps the model it started with.
 */
export async function reloadConfig(deps: ReloadConfigDeps, projectId: string): Promise<string> {
  const project = deps.repos.projects.get(projectId);
  if (project === undefined) throw notFound('project not found');

  const counts: ReloadCounts = { providers: 0, mcpServers: 0, skills: 0, commands: 0 };
  const failures: string[] = [];
  const discovery = deps.onWarning === undefined ? {} : { onWarning: deps.onWarning };

  try {
    deps.bus?.emit({ kind: 'event', type: 'settings.updated', payload: deps.repos.settings.get() });
  } catch (error) {
    failures.push(`settings (${message(error)})`);
  }

  try {
    const providers = deps.repos.providers.list();
    counts.providers = providers.length;
    deps.bus?.emit({ kind: 'event', type: 'providers.updated', payload: providers });
  } catch (error) {
    failures.push(`providers (${message(error)})`);
  }

  try {
    await deps.mcp?.invalidate();
    const servers = deps.repos.mcp.list();
    counts.mcpServers = servers.filter((server) => server.enabled).length;
    for (const server of servers) {
      deps.bus?.emit({ kind: 'event', type: 'mcp.updated', payload: server });
    }
  } catch (error) {
    failures.push(`MCP servers (${message(error)})`);
  }

  try {
    const skills = discoverSkills(project.path, {
      ...discovery,
      pluginRoots: pluginSkillRoots(deps.repos),
    });
    counts.skills = skills.length;
    deps.bus?.emit({ kind: 'event', type: 'skills.updated', payload: {} });
  } catch (error) {
    failures.push(`skills (${message(error)})`);
  }

  try {
    const commands = listCommands(project.path, {
      ...discovery,
      pluginDirs: pluginCommandDirs(deps.repos),
    });
    counts.commands = commands.length;
    deps.bus?.emit({ kind: 'event', type: 'commands.updated', payload: {} });
  } catch (error) {
    failures.push(`commands (${message(error)})`);
  }

  try {
    deps.bus?.emit({ kind: 'event', type: 'plugins.updated', payload: deps.repos.plugins.list() });
  } catch (error) {
    failures.push(`plugins (${message(error)})`);
  }

  const summary = `Reloaded ${counts.providers} providers, ${counts.mcpServers} MCP servers, ${counts.skills} skills, ${counts.commands} commands.`;
  return failures.length === 0 ? summary : `${summary} Failed: ${failures.join('; ')}.`;
}
