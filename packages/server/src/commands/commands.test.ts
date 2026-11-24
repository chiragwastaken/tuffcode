import type { Command } from '@tuffcode/contracts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProject } from '../projects.js';
import { createTestContext, initRepo, type TestContext } from '../test-support.js';
import {
  BUILT_IN_COMMANDS,
  createCommandHandlers,
  expandArguments,
  expandCommand,
  listCommands,
  parseCommand,
} from './index.js';

function writeCommand(projectPath: string, file: string, content: string): string {
  const dir = join(projectPath, '.tuffcode', 'commands');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, file);
  writeFileSync(filePath, content);
  return filePath;
}

function commandFile(name: string, description: string, hint?: string, body = 'body'): string {
  const hintLine = hint === undefined ? '' : `argument-hint: ${hint}\n`;
  return `---\nname: ${name}\ndescription: ${description}\n${hintLine}---\n${body}\n`;
}

describe('slash commands', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('parses built-in commands and treats everything else as a message', () => {
    expect(parseCommand('/plan build the parser')).toEqual({
      name: 'plan',
      args: 'build the parser',
    });
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' });
    expect(parseCommand('/compact   keep tests ')).toEqual({
      name: 'compact',
      args: 'keep tests',
    });
    expect(parseCommand('/council ship it\nsecond line')).toEqual({
      name: 'council',
      args: 'ship it\nsecond line',
    });
    expect(parseCommand('please /plan')).toEqual({ message: 'please /plan' });
    expect(parseCommand('/unknown thing')).toEqual({ message: '/unknown thing' });
    expect(parseCommand(' /plan')).toEqual({ message: ' /plan' });
    expect(parseCommand('')).toEqual({ message: '' });
  });

  it('accepts discovered command names when given them', () => {
    expect(parseCommand('/review src/app.ts', ['review'])).toEqual({
      name: 'review',
      args: 'src/app.ts',
    });
    expect(parseCommand('/review', ['review'])).toEqual({ name: 'review', args: '' });
    expect(parseCommand('/model opus', ['review'])).toEqual({ name: 'model', args: 'opus' });
  });

  it('discovers project commands and skips invalid files with warnings', () => {
    const project = join(ctx.env.root, 'project');
    const reviewPath = writeCommand(
      project,
      'review.md',
      commandFile('review', 'Review the current diff', '"[path]"', 'Review $ARGUMENTS'),
    );
    writeCommand(project, 'plain.md', 'no frontmatter here\n');
    writeCommand(project, 'nameless.md', '---\ndescription: Missing a name\n---\nbody\n');
    writeCommand(project, 'reserved.md', commandFile('model', 'Shadow the built-in'));
    writeCommand(project, 'notes.txt', 'ignored\n');

    const warnings: string[] = [];
    const commands = listCommands(project, { onWarning: (message) => warnings.push(message) });

    expect(commands.slice(0, BUILT_IN_COMMANDS.length).map((command) => command.name)).toEqual(
      BUILT_IN_COMMANDS.map((command) => command.name),
    );
    expect(commands.find((command) => command.name === 'review')).toEqual({
      name: 'review',
      description: 'Review the current diff',
      body: 'Review $ARGUMENTS',
      path: reviewPath,
      argumentHint: '[path]',
    });
    expect(commands.some((command) => command.name === 'plain')).toBe(false);
    expect(commands.some((command) => command.name === 'nameless')).toBe(false);
    expect(commands.filter((command) => command.name === 'model')).toHaveLength(1);
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toContain('plain.md');
    expect(warnings.join('\n')).toContain('nameless.md');
    expect(warnings.join('\n')).toContain('built in');
  });

  it('keeps the first file when two commands share a name', () => {
    const project = join(ctx.env.root, 'project');
    writeCommand(project, 'a.md', commandFile('review', 'First'));
    writeCommand(project, 'b.md', commandFile('review', 'Second'));
    const warnings: string[] = [];
    const commands = listCommands(project, { onWarning: (message) => warnings.push(message) });
    expect(commands.filter((command) => command.name === 'review')).toHaveLength(1);
    expect(commands.find((command) => command.name === 'review')?.description).toBe('First');
    expect(warnings.join('\n')).toContain('duplicate command review');
  });

  it('expands $ARGUMENTS and positional placeholders in one pass', () => {
    expect(expandArguments('Goal: $ARGUMENTS\nFirst: $1\nSecond: $2\nTenth: $10', 'fix bug')).toBe(
      'Goal: fix bug\nFirst: fix\nSecond: bug\nTenth: $10',
    );
    expect(expandArguments('$1/$2/$9', 'one two')).toBe('one/two/');
    expect(expandArguments('$ARGUMENTS and $2', '$2 literal')).toBe('$2 literal and literal');
    expect(expandArguments('nothing to fill', 'ignored')).toBe('nothing to fill');
    expect(expandCommand({ body: 'run $1' }, 'tests')).toBe('run tests');
  });

  it('serves commands.list for a project', async () => {
    const repo = initRepo(join(ctx.env.root, 'repo'));
    const project = await addProject(ctx.repos, repo);
    writeCommand(
      repo,
      'deploy.md',
      commandFile('deploy', 'Deploy the app', undefined, 'Deploy $1'),
    );

    const handler = createCommandHandlers({ repos: ctx.repos }).get('commands.list');
    if (handler === undefined) throw new Error('commands.list is not registered');
    const result = (await handler({ projectId: project.id })) as Command[];
    const deploy = result.find((command) => command.name === 'deploy');
    expect(deploy).toMatchObject({
      description: 'Deploy the app',
      body: 'Deploy $1',
      path: join(repo, '.tuffcode', 'commands', 'deploy.md'),
    });
    expect(result.map((command) => command.name)).toContain('model');
    expect(() => handler({ projectId: 'prj_missing' })).toThrow('project not found');
  });
});
