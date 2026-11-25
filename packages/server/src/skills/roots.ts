import { join } from 'node:path';
import type { Repos } from '../db/repos/index.js';
import type { PluginSkillRoot } from './discover.js';

/** The `commands` directory of every enabled plugin that ships commands. */
export function pluginCommandDirs(repos: Pick<Repos, 'plugins'>): string[] {
  return repos.plugins
    .list()
    .filter((plugin) => plugin.enabled && plugin.components.commands.length > 0)
    .map((plugin) => join(plugin.installPath, 'commands'));
}

/** The `skills` directory of every enabled plugin, in install order. */
export function pluginSkillRoots(repos: Pick<Repos, 'plugins'>): PluginSkillRoot[] {
  return repos.plugins
    .list()
    .filter((plugin) => plugin.enabled && plugin.components.skills.length > 0)
    .map((plugin) => ({ root: join(plugin.installPath, 'skills'), pluginId: plugin.id }));
}
