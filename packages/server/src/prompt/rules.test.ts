import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_RULES_TOKEN_BUDGET,
  PROJECT_RULE_TOKEN_BUDGET,
  loadProjectRules,
  matchesGlob,
  parseRuleFrontmatter,
  pathTokens,
} from './rules.js';

/** A project root plus an outside directory, both under one temp parent. */
interface RuleEnv {
  root: string;
  outside: string;
  dispose(): void;
}

function createEnv(): RuleEnv {
  const parent = mkdtempSync(join(tmpdir(), 'tuffcode-rules-'));
  const root = join(parent, 'project');
  const outside = join(parent, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return {
    root,
    outside,
    dispose: () => rmSync(parent, { recursive: true, force: true }),
  };
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

/** `tokens` worth of prose at the estimator's four characters per token. */
function prose(tokens: number): string {
  const sentence = 'This repository keeps its tests next to the code they cover. ';
  return sentence.repeat(Math.ceil((tokens * 4) / sentence.length)).slice(0, tokens * 4);
}

describe('project rules loader', () => {
  let env: RuleEnv;

  beforeEach(() => {
    env = createEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  it('loads AGENTS.md then CLAUDE.md in a stable order', () => {
    write(env.root, 'CLAUDE.md', 'Claude rule body.');
    write(env.root, 'AGENTS.md', 'Agents rule body.');

    const plan = loadProjectRules(env.root, 'anything');

    expect(plan.rules.map((rule) => rule.path)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(plan.text.indexOf('### AGENTS.md')).toBeLessThan(plan.text.indexOf('### CLAUDE.md'));
    expect(plan.text).toContain('Agents rule body.');
    expect(plan.text).toContain('Claude rule body.');
    expect(plan.tokens).toBeGreaterThan(0);
  });

  it('sorts .tuffcode/rules by file name, not by creation order', () => {
    write(env.root, '.tuffcode/rules/zeta.md', 'zeta body');
    write(env.root, '.tuffcode/rules/alpha.md', 'alpha body');
    write(env.root, '.tuffcode/rules/middle.md', 'middle body');
    write(env.root, '.tuffcode/rules/notes.txt', 'not a rule');

    const plan = loadProjectRules(env.root, 'anything');

    expect(plan.rules.map((rule) => rule.path)).toEqual([
      '.tuffcode/rules/alpha.md',
      '.tuffcode/rules/middle.md',
      '.tuffcode/rules/zeta.md',
    ]);
    expect(plan.text).not.toContain('not a rule');
  });

  it('parses frontmatter and keeps it out of the body', () => {
    write(
      env.root,
      'AGENTS.md',
      ['---', 'description: House style for this repo.', 'alwaysApply: true', '---', '', 'Body text.'].join(
        '\n',
      ),
    );

    const plan = loadProjectRules(env.root, 'hello');
    const rule = plan.rules[0];

    expect(rule?.description).toBe('House style for this repo.');
    expect(rule?.globs).toBeNull();
    expect(rule?.text).toBe('Body text.');
    expect(plan.text).toContain('### AGENTS.md\n_House style for this repo._\nBody text.');
    expect(plan.text).not.toContain('alwaysApply');
    expect(plan.text).not.toContain('---');
  });

  it('includes a glob-scoped rule only when the message names a matching path', () => {
    write(
      env.root,
      '.tuffcode/rules/web.md',
      ['---', 'globs: ["apps/web/**", "packages/ui/*.tsx"]', '---', 'Web rules apply.'].join('\n'),
    );

    const matching = loadProjectRules(env.root, 'fix apps/web/src/app.tsx please');
    expect(matching.rules.map((rule) => rule.path)).toEqual(['.tuffcode/rules/web.md']);
    expect(matching.text).toContain('Web rules apply.');

    const bare = loadProjectRules(env.root, 'how do I run the tests');
    expect(bare.rules).toEqual([]);
    expect(bare.text).toBe('');

    const sibling = loadProjectRules(env.root, 'fix apps/server/src/app.ts');
    expect(sibling.text).toBe('');
  });

  it('accepts a comma list and a block list for globs', () => {
    write(
      env.root,
      '.tuffcode/rules/comma.md',
      ['---', 'globs: src/**/*.{ts,tsx}, docs/**', '---', 'comma body'].join('\n'),
    );
    write(
      env.root,
      '.tuffcode/rules/block.md',
      ['---', 'globs:', '  - scripts/*.mjs', '  - README.md', '---', 'block body'].join('\n'),
    );

    const brace = loadProjectRules(env.root, 'touch src/components/Button.tsx');
    expect(brace.rules.map((rule) => rule.path)).toEqual(['.tuffcode/rules/comma.md']);

    const block = loadProjectRules(env.root, 'update scripts/release.mjs');
    expect(block.rules.map((rule) => rule.path)).toEqual(['.tuffcode/rules/block.md']);

    const bareName = loadProjectRules(env.root, 'rewrite README.md');
    expect(bareName.rules.map((rule) => rule.path)).toEqual(['.tuffcode/rules/block.md']);
  });

  it('skips a rule whose directory symlink escapes the project root', () => {
    write(env.outside, 'escaped.md', 'outside body');
    mkdirSync(join(env.root, '.tuffcode'), { recursive: true });
    // A junction works on Windows without elevation; a directory symlink elsewhere.
    symlinkSync(env.outside, join(env.root, '.tuffcode', 'rules'), process.platform === 'win32' ? 'junction' : 'dir');
    // The listing reaches the outside file; only the escape guard keeps it out.
    expect(readdirSync(join(env.root, '.tuffcode', 'rules'))).toEqual(['escaped.md']);

    const plan = loadProjectRules(env.root, 'anything');

    expect(plan.rules).toEqual([]);
    expect(plan.text).toBe('');
    expect(plan.text).not.toContain('outside body');
  });

  it('ignores missing files and empty rule files', () => {
    const empty = loadProjectRules(env.root, 'anything');
    expect(empty).toEqual({ rules: [], skipped: [], text: '', tokens: 0 });

    write(env.root, 'AGENTS.md', '   \n\n');
    write(env.root, 'CLAUDE.md', '---\ndescription: header only\n---\n');
    const blank = loadProjectRules(env.root, 'anything');
    expect(blank.rules).toEqual([]);
    expect(blank.text).toBe('');
  });

  it('never throws on an unreadable rules directory', () => {
    // A file where the rules directory belongs is not a directory.
    write(env.root, '.tuffcode/rules', 'not a directory');

    expect(() => loadProjectRules(env.root, 'anything')).not.toThrow();
    expect(loadProjectRules(env.root, 'anything').rules).toEqual([]);
  });

  it('truncates a 5000 token AGENTS.md to the per-file cap with a marker', () => {
    write(env.root, 'AGENTS.md', prose(5000));

    const plan = loadProjectRules(env.root, 'anything');
    const rule = plan.rules[0];

    expect(rule?.truncated).toBe(true);
    expect(rule?.text).toContain(`[... truncated at ${PROJECT_RULE_TOKEN_BUDGET} tokens]`);
    expect(rule?.text.length).toBeLessThan(PROJECT_RULE_TOKEN_BUDGET * 4 + 200);
    expect(plan.text).toContain('Truncated to fit: AGENTS.md');
    expect(plan.tokens).toBeLessThanOrEqual(PROJECT_RULES_TOKEN_BUDGET);
  });

  it('drops files past the section budget and lists them', () => {
    write(env.root, 'AGENTS.md', prose(700));
    write(env.root, 'CLAUDE.md', prose(700));
    write(env.root, '.tuffcode/rules/third.md', prose(700));

    const plan = loadProjectRules(env.root, 'anything');

    expect(plan.rules.map((rule) => rule.path)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(plan.skipped).toEqual(['.tuffcode/rules/third.md']);
    expect(plan.text).toContain('Skipped for length: .tuffcode/rules/third.md');
    expect(plan.tokens).toBeLessThanOrEqual(PROJECT_RULES_TOKEN_BUDGET);
  });

  it('keeps the whole section inside 2000 tokens', () => {
    write(env.root, 'AGENTS.md', prose(1200));
    write(env.root, 'CLAUDE.md', prose(1200));
    write(env.root, '.tuffcode/rules/third.md', prose(1200));

    const plan = loadProjectRules(env.root, 'anything');

    expect(plan.tokens).toBeLessThanOrEqual(PROJECT_RULES_TOKEN_BUDGET);
    expect(plan.tokens).toBeGreaterThan(0);
    expect(plan.rules.map((rule) => rule.path)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(plan.skipped).toEqual(['.tuffcode/rules/third.md']);
  });
});

describe('rule frontmatter parser', () => {
  it('treats a file with no header as body only', () => {
    expect(parseRuleFrontmatter('plain body')).toEqual({ data: {}, body: 'plain body' });
  });

  it('treats an unclosed header as body only', () => {
    const parsed = parseRuleFrontmatter('---\ndescription: half a header\nplain body');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toContain('description: half a header');
  });

  it('reads inline arrays, quoted scalars and block lists', () => {
    const parsed = parseRuleFrontmatter(
      [
        '---',
        'description: "Quoted: value"',
        'globs: [src/**, "docs/**"]',
        'tags:',
        '  - one',
        '  - two',
        '---',
        'body',
      ].join('\n'),
    );
    expect(parsed.data['description']).toBe('Quoted: value');
    expect(parsed.data['globs']).toEqual(['src/**', 'docs/**']);
    expect(parsed.data['tags']).toEqual(['one', 'two']);
    expect(parsed.body).toBe('body');
  });
});

describe('glob matching', () => {
  it('matches segments, deep paths and alternations', () => {
    expect(matchesGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(matchesGlob('src/**/*.ts', 'src/c.ts')).toBe(true);
    expect(matchesGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(matchesGlob('**/*.tsx', 'apps/web/App.tsx')).toBe(true);
    expect(matchesGlob('src/**/*.{ts,tsx}', 'src/a.tsx')).toBe(true);
    expect(matchesGlob('src/**/*.{ts,tsx}', 'src/a.css')).toBe(false);
    expect(matchesGlob('a?c.ts', 'abc.ts')).toBe(true);
  });

  it('matches a bare glob against the basename', () => {
    expect(matchesGlob('*.md', 'docs/guide.md')).toBe(true);
    expect(matchesGlob('*.md', 'docs/guide.txt')).toBe(false);
  });

  it('treats regex metacharacters in a glob literally', () => {
    expect(matchesGlob('src/a+b.ts', 'src/a+b.ts')).toBe(true);
    expect(matchesGlob('src/a+b.ts', 'src/aab.ts')).toBe(false);
  });

  it('extracts path-like tokens from a message', () => {
    expect(pathTokens('fix `src/app.ts` and (docs/README.md), not http')).toEqual([
      'src/app.ts',
      'docs/README.md',
    ]);
    expect(pathTokens('no paths here')).toEqual([]);
  });
});
