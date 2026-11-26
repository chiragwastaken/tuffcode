import { describe, expect, it } from 'vitest';
import { createTempEnv } from '../test-support.js';
import { discoverSkills, loadSkill, readSkillBody } from './discover.js';
import {
  SELF_CONFIG_SKILL,
  SYSTEM_SKILLS,
  isSystemSkillPath,
  matchesSelfConfigIntent,
  systemSkillBody,
  systemSkillPath,
} from './system.js';

describe('system skills', () => {
  it('ships edit-tuffcode first with the concrete self-config instructions', () => {
    expect(SYSTEM_SKILLS[0]?.name).toBe(SELF_CONFIG_SKILL);
    const body = SYSTEM_SKILLS[0]?.body ?? '';

    expect(body).toContain('`config` tool');
    expect(body).toContain('keychain');
    expect(body).toContain('`secret`');
    expect(body).toContain('`apiKey`');
    expect(body).toContain('`token`');
    expect(body).toContain('`secretEnv`');
    expect(body).toContain('Never print, echo, log or repeat a credential');
    expect(body).toContain("thread's worktree");
    expect(body).toContain('`pnpm check`');
    expect(body).toContain('`/reload`');
    expect(body).toContain('Settings > Providers');
    expect(body).toContain('Settings > MCP env');
    expect(/[\u2013\u2014]/.test(body)).toBe(false);
  });

  it('reports a synthetic path and serves the body without touching disk', () => {
    const env = createTempEnv();
    try {
      const path = systemSkillPath(SELF_CONFIG_SKILL);
      expect(isSystemSkillPath(path)).toBe(true);
      expect(systemSkillBody(path)).toBe(SYSTEM_SKILLS[0]?.body);
      expect(systemSkillBody('system:missing')).toBeUndefined();
      expect(() => readSkillBody('system:missing', [])).toThrow(/skill not found/);
      expect(readSkillBody(path, [])).toContain('config');
      expect(loadSkill(env.root, SELF_CONFIG_SKILL)).toContain('config');
    } finally {
      env.dispose();
    }
  });

  it('is discoverable in a project with no skills at all', () => {
    const env = createTempEnv();
    try {
      expect(discoverSkills(env.root).map((skill) => skill.name)).toEqual([SELF_CONFIG_SKILL]);
    } finally {
      env.dispose();
    }
  });
});

describe('matchesSelfConfigIntent', () => {
  it.each([
    'add this MCP server',
    'add a provider with this base URL and key',
    'add this model to the local provider',
    'change the default permission mode to accept edits',
    'edit Tuffcode so the topbar switch is centered',
    'update settings so auto compact is off',
    'connect this MCP connector for me',
    'install the provider I pasted',
    'set the default permission mode to ask',
    'change the theme in Tuffcode settings',
  ])('matches %s', (message) => {
    expect(matchesSelfConfigIntent(message)).toBe(true);
  });

  it.each([
    'how do I run the preview',
    'refactor the parser in src/parse.ts',
    'add a test for the timeline fold',
    'show me the mcp servers',
    'explain how settings work',
    'run the settings screen tests',
    'what does the model cost',
    'why is the build slow',
  ])('ignores %s', (message) => {
    expect(matchesSelfConfigIntent(message)).toBe(false);
  });
});
