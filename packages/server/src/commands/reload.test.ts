import type { ServerEvent } from '@tuffcode/contracts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../events.js';
import { discoverSkills } from '../skills/discover.js';
import { pluginCommandDirs, pluginSkillRoots } from '../skills/roots.js';
import {
  createProjectThread,
  createTestContext,
  initRepo,
  type TestContext,
} from '../test-support.js';
import { listCommands } from './discover.js';
import { reloadConfig } from './reload.js';

function writeSkill(projectPath: string): void {
  const dir = join(projectPath, '.tuffcode', 'skills', 'release');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: release\ndescription: Cut a release\n---\nBody\n',
  );
}

function writeCommand(projectPath: string): void {
  const dir = join(projectPath, '.tuffcode', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'review.md'),
    '---\nname: review\ndescription: Review a diff\n---\nBody\n',
  );
}

describe('commands.reload', () => {
  let ctx: TestContext;
  let repo: string;
  let projectId: string;
  let events: ServerEvent[];

  beforeEach(async () => {
    ctx = createTestContext();
    repo = initRepo(join(ctx.env.root, 'reload-repo'));
    const { project } = await createProjectThread(ctx.repos, repo);
    projectId = project.id;
    writeSkill(repo);
    writeCommand(repo);
    events = [];
    ctx.repos.mcp.upsert({ label: 'files', command: 'fake-mcp' });
    ctx.repos.providers.upsert({
      id: 'prv_second',
      kind: 'openai-compatible',
      label: 'Second',
      config: {},
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('reloads every section once and reports the counts', async () => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    const invalidate = vi.fn(() => Promise.resolve());
    const settingsGet = vi.spyOn(ctx.repos.settings, 'get');
    const providerList = vi.spyOn(ctx.repos.providers, 'list');
    const pluginList = vi.spyOn(ctx.repos.plugins, 'list');

    const skills = discoverSkills(repo, { pluginRoots: pluginSkillRoots(ctx.repos) });
    const commands = listCommands(repo, { pluginDirs: pluginCommandDirs(ctx.repos) });
    const text = await reloadConfig({ repos: ctx.repos, bus, mcp: { invalidate } }, projectId);

    expect(text).toBe(
      `Reloaded 2 providers, 1 MCP servers, ${skills.length} skills, ${commands.length} commands.`,
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(settingsGet).toHaveBeenCalledTimes(1);
    expect(providerList).toHaveBeenCalledTimes(1);
    expect(pluginList).toHaveBeenCalled();

    const types = events.map((event) => event.type);
    expect(types).toContain('settings.updated');
    expect(types).toContain('providers.updated');
    expect(types).toContain('mcp.updated');
    expect(types).toContain('skills.updated');
    expect(types).toContain('commands.updated');
    expect(types).toContain('plugins.updated');
    const providers = events.find((event) => event.type === 'providers.updated');
    if (providers?.type !== 'providers.updated') throw new Error('missing providers.updated');
    expect(providers.payload).toHaveLength(2);
    expect(events.filter((event) => event.type === 'mcp.updated')).toHaveLength(1);
  });

  it('reports one failing section and still reloads the rest', async () => {
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));
    const invalidate = vi.fn(() => Promise.reject(new Error('bridge down')));

    const text = await reloadConfig({ repos: ctx.repos, bus, mcp: { invalidate } }, projectId);

    expect(text).toContain('Failed: MCP servers (bridge down)');
    const types = events.map((event) => event.type);
    expect(types).not.toContain('mcp.updated');
    for (const type of [
      'settings.updated',
      'providers.updated',
      'skills.updated',
      'commands.updated',
      'plugins.updated',
    ]) {
      expect(types).toContain(type);
    }
  });

  it('skips the connector section when no MCP service is wired', async () => {
    const text = await reloadConfig({ repos: ctx.repos }, projectId);
    expect(text).toContain('1 MCP servers');
    expect(text).not.toContain('Failed');
  });

  it('refuses an unknown project', async () => {
    await expect(reloadConfig({ repos: ctx.repos }, 'prj_missing')).rejects.toThrow(
      'project not found',
    );
  });
});
