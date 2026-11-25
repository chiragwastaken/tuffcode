import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempEnv, type TempEnv } from '../test-support.js';
import { discoverSkills, readSkillBody, skillRoots, type SkillSummary } from './discover.js';
import {
  AVAILABLE_SKILLS_LIMIT,
  availableSkillsList,
  expandSkillMentions,
  renderSkillSections,
  skillMentions,
} from './inject.js';

function skill(name: string, description = `${name} skill`): SkillSummary {
  return { name, description, path: `C:/skills/${name}/SKILL.md`, source: 'user', pluginId: null };
}

function writeSkill(root: string, name: string, body: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(
    join(root, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`,
  );
}

describe('skill mentions', () => {
  it('finds $name mentions in order once each and ignores dollar amounts', () => {
    expect(skillMentions('$deploy then $review, again $deploy; costs $5 or ($lint)')).toEqual([
      'deploy',
      'review',
      '5',
      'lint',
    ]);
    expect(skillMentions('price$tag is not a mention')).toEqual([]);
  });

  it('expands known skills in order, reports unknown words, and keeps the budget', () => {
    const skills = [skill('deploy'), skill('review'), skill('huge')];
    const bodies: Record<string, string> = {
      deploy: 'run deploy.ps1',
      review: 'apply the rubric',
      huge: 'x'.repeat(40_000),
    };
    const result = expandSkillMentions(
      '$review $deploy $huge $missing costs $5',
      skills,
      (entry) => bodies[entry.name] ?? '',
    );
    expect(result.sections.map((section) => section.name)).toEqual(['review', 'deploy']);
    expect(result.skipped).toEqual(['huge']);
    expect(result.unknown).toEqual(['missing']);
    expect(renderSkillSections(result.sections)).toBe(
      '### Skill: review\napply the rubric\n\n### Skill: deploy\nrun deploy.ps1',
    );
  });

  it('lists the other skills compactly and caps the list', () => {
    const many = Array.from({ length: AVAILABLE_SKILLS_LIMIT + 10 }, (_, index) => skill(`s${index}`));
    const list = availableSkillsList(many, ['s0']).split('\n');
    expect(list[0]).toBe('- s1: s1 skill');
    expect(list.length).toBeLessThanOrEqual(AVAILABLE_SKILLS_LIMIT);
  });
});

describe('skill roots', () => {
  let env: TempEnv;
  beforeEach(() => {
    env = createTempEnv();
  });
  afterEach(() => env.dispose());

  it('searches project, .claude, user, then plugins, and the first name wins', () => {
    const project = join(env.root, 'project');
    const plugin = join(env.root, 'plugin', 'skills');
    writeSkill(join(project, '.tuffcode', 'skills'), 'deploy', 'project deploy');
    writeSkill(join(project, '.claude', 'skills'), 'deploy', 'claude deploy');
    writeSkill(join(project, '.claude', 'skills'), 'lint', 'claude lint');
    writeSkill(plugin, 'lint', 'plugin lint');
    writeSkill(plugin, 'chart', 'plugin chart');
    const pluginRoots = [{ root: plugin, pluginId: 'plg_1' }];
    const found = discoverSkills(project, { pluginRoots, onWarning: () => undefined });
    expect(found.map((entry) => [entry.name, entry.source, entry.pluginId])).toEqual([
      ['chart', 'plugin', 'plg_1'],
      ['deploy', 'project', null],
      ['lint', 'claude-project', null],
    ]);
    const chart = found.find((entry) => entry.name === 'chart');
    expect(readSkillBody(chart?.path ?? '', skillRoots(project, pluginRoots)).trim()).toBe('plugin chart');
    expect(() => readSkillBody(chart?.path ?? '', skillRoots(project))).toThrow(/escapes/);
  });
});
