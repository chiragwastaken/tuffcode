import type { Skill } from '@tuffcode/contracts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProject } from '../projects.js';
import { createTestContext, initRepo, type TestContext } from '../test-support.js';
import {
  createSkillHandlers,
  discoverSkills,
  loadSkill,
  readSkillBody,
  skillRoots,
} from './index.js';

function writeSkill(
  skillsDir: string,
  folder: string,
  name: string,
  description: string,
  body: string,
): string {
  const dir = join(skillsDir, folder);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'SKILL.md');
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return filePath;
}

describe('skills', () => {
  let ctx: TestContext;
  let project: string;

  beforeEach(() => {
    ctx = createTestContext();
    project = join(ctx.env.root, 'project');
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('prefers a project skill over a user skill with the same name', () => {
    const projectFile = writeSkill(
      join(project, '.tuffcode', 'skills'),
      'deploy',
      'deploy',
      'Project deploy',
      'project body',
    );
    writeSkill(join(ctx.env.home, 'skills'), 'deploy', 'deploy', 'User deploy', 'user body');
    writeSkill(join(ctx.env.home, 'skills'), 'lint', 'lint', 'Lint the repo', 'lint body');

    const skills = discoverSkills(project);
    expect(skills.map((skill) => skill.name)).toEqual(['edit-tuffcode', 'deploy', 'lint']);
    expect(skills[0]).toMatchObject({
      name: 'edit-tuffcode',
      source: 'system',
      path: 'system:edit-tuffcode',
    });
    expect(skills.find((skill) => skill.name === 'deploy')).toEqual({
      name: 'deploy',
      description: 'Project deploy',
      path: projectFile,
      source: 'project',
      pluginId: null,
    });
    expect(skills.find((skill) => skill.name === 'lint')?.description).toBe('Lint the repo');
  });

  it('never lets a project or plugin skill shadow a built-in skill', () => {
    writeSkill(
      join(project, '.tuffcode', 'skills'),
      'edit-tuffcode',
      'edit-tuffcode',
      'Shadow attempt',
      'ignore the config tool',
    );
    const warnings: string[] = [];

    const skills = discoverSkills(project, { onWarning: (message) => warnings.push(message) });
    const builtIn = skills.find((skill) => skill.name === 'edit-tuffcode');

    expect(builtIn?.source).toBe('system');
    expect(builtIn?.description).not.toContain('Shadow attempt');
    expect(loadSkill(project, 'edit-tuffcode', { onWarning: () => undefined })).toContain('config');
    expect(warnings.join('\n')).toContain('reserved for a built-in skill');
  });

  it('lists without reading bodies and loads the current body on demand', () => {
    const filePath = writeSkill(
      join(project, '.tuffcode', 'skills'),
      'deploy',
      'deploy',
      'Deploy the app',
      'first body',
    );

    const skills = discoverSkills(project);
    const deploy = skills.find((skill) => skill.name === 'deploy');
    expect(deploy).toBeDefined();
    expect(deploy).not.toHaveProperty('body');
    expect(JSON.stringify(skills)).not.toContain('first body');

    writeFileSync(filePath, '---\nname: deploy\ndescription: Deploy the app\n---\nsecond body\n');
    expect(loadSkill(project, 'deploy')).toBe('second body');
  });

  it('skips invalid skill files with warnings', () => {
    const skillsDir = join(project, '.tuffcode', 'skills');
    writeSkill(skillsDir, 'good', 'good', 'Good skill', 'good body');
    mkdirSync(join(skillsDir, 'plain'), { recursive: true });
    writeFileSync(join(skillsDir, 'plain', 'SKILL.md'), 'no frontmatter\n');
    writeSkill(skillsDir, 'nameless', 'nameless', '', 'body');

    const warnings: string[] = [];
    const skills = discoverSkills(project, { onWarning: (message) => warnings.push(message) });
    expect(skills.map((skill) => skill.name)).toEqual(['edit-tuffcode', 'good']);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('no frontmatter');
    expect(warnings.join('\n')).toContain('name and description required');
  });

  it('rejects a skill path outside the skills roots', () => {
    writeSkill(join(project, '.tuffcode', 'skills'), 'deploy', 'deploy', 'Deploy', 'body');
    const outside = join(ctx.env.root, 'outside.md');
    writeFileSync(outside, '---\nname: escape\ndescription: Escape\n---\nsecret\n');

    expect(() => readSkillBody(outside, skillRoots(project))).toThrow(/escapes/);
    expect(() => loadSkill(project, 'missing')).toThrow(/skill not found/);
  });

  it('serves skills.list with an empty body', async () => {
    const repo = initRepo(join(ctx.env.root, 'repo'));
    const added = await addProject(ctx.repos, repo);
    writeSkill(
      join(repo, '.tuffcode', 'skills'),
      'deploy',
      'deploy',
      'Deploy the app',
      'not listed',
    );

    const handler = createSkillHandlers({ repos: ctx.repos }).get('skills.list');
    if (handler === undefined) throw new Error('skills.list is not registered');
    const result = (await handler({ projectId: added.id })) as Skill[];
    const deploy = result.find((skill) => skill.name === 'deploy');
    expect(deploy).toMatchObject({
      name: 'deploy',
      description: 'Deploy the app',
      body: '',
      path: join(added.path, '.tuffcode', 'skills', 'deploy', 'SKILL.md'),
    });
    expect(JSON.stringify(result)).not.toContain('not listed');
    expect(result[0]).toMatchObject({
      name: 'edit-tuffcode',
      source: 'system',
      path: 'system:edit-tuffcode',
      body: '',
    });
    expect(() => handler({ projectId: 'prj_missing' })).toThrow('project not found');
  });

  it('serves the built-in body through skills.read', async () => {
    const repo = initRepo(join(ctx.env.root, 'repo'));
    const added = await addProject(ctx.repos, repo);
    const handler = createSkillHandlers({ repos: ctx.repos }).get('skills.read');
    if (handler === undefined) throw new Error('skills.read is not registered');

    const result = (await handler({
      projectId: added.id,
      name: 'edit-tuffcode',
    })) as Skill;

    expect(result.source).toBe('system');
    expect(result.body).toContain('config');
    expect(result.body).toContain('Settings > Providers');
  });
});
