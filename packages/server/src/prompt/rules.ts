/**
 * Project rules committed in the repository: `AGENTS.md`, `CLAUDE.md` and every
 * `.tuffcode/rules/*.md`. Rules are always on and are read from the project root only,
 * never from a parent directory or the user's home.
 *
 * Frontmatter is optional and deliberately tiny: `alwaysApply: true` pins a rule to
 * every turn, `globs` (a string or an array) scopes it to messages that name a matching
 * path, and `description` renders as one line under the heading. A rule without
 * frontmatter, or with frontmatter that declares no `globs`, applies to every turn.
 *
 * Glob matching runs over path-like tokens in the user message, so a scoped rule can
 * only fire when the message itself names a path; it never inspects the repository and
 * never knows which files the model will touch later. `*` stays inside one path
 * segment, `**` crosses segments, `{a,b}` alternates, matching is case-sensitive, and a
 * glob without a slash also matches a token's basename (`*.md` matches `src/a.md`).
 *
 * Budgets are 800 tokens per file and 2000 tokens for the whole section, measured with
 * the prompt estimator. A cut file keeps its opening text plus an explicit marker and
 * is listed under `Truncated to fit`; a file that no longer fits the section is listed
 * under `Skipped for length`. A missing, empty, unreadable, oversized or escaping file
 * is skipped and never throws, because a bad rule file must not fail a turn.
 */
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { estimateTokens } from '@tuffcode/prompt';
import { isInside } from '@tuffcode/shared';

export const PROJECT_RULES_TOKEN_BUDGET = 2000;
export const PROJECT_RULE_TOKEN_BUDGET = 800;

/** Headroom for the truncation markers and the skipped/truncated trailers. */
const MARKER_RESERVE_TOKENS = 100;

/** The estimator's ratio; truncation works in characters, budgets in tokens. */
const CHARS_PER_TOKEN = 4;

/** A rule file larger than this is read up to the cap, never into memory whole. */
const MAX_RULE_FILE_BYTES = 512 * 1024;

const MAX_DESCRIPTION_CHARS = 200;

const ALWAYS_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;
const RULES_DIR = '.tuffcode/rules';

/** Files that apply to every turn. */
export interface ProjectRule {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** Frontmatter description, or null when the file declares none. */
  description: string | null;
  /** Globs that scope the rule, or null when it always applies. */
  globs: string[] | null;
  /** Body without frontmatter, capped at the per-file budget. */
  text: string;
  /** True when the body was cut at the per-file budget. */
  truncated: boolean;
}

export interface ProjectRulesPlan {
  /** Rules that applied to this message, in section order. */
  rules: ProjectRule[];
  /** Paths that applied but did not fit under the section budget. */
  skipped: string[];
  /** Renderable `### path` blocks; empty when no rule applied. */
  text: string;
  /** Tokens of `text`, zero when no rule applied. */
  tokens: number;
}

export interface RuleFrontmatter {
  /** Flat header values; `globs` may be a list, every other key a string. */
  data: Record<string, string | string[]>;
  /** Text after the closing delimiter, trimmed. */
  body: string;
}

const OPENING = /^---[ \t]*\r?\n/;
const CLOSING = /^---[ \t]*$/m;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split a comma list while keeping commas inside braces and quotes. */
function splitList(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map(unquote).filter((item) => item.length > 0);
}

/**
 * Parses the optional `key: value` header of a rule file. Scalars, inline lists
 * (`[a, b]`) and block lists (`- a`) are supported; nested YAML is not. A file with no
 * header, or an unclosed header, is treated as body only, so a stray `---` rule cannot
 * swallow the text.
 */
export function parseRuleFrontmatter(text: string): RuleFrontmatter {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const opening = OPENING.exec(source);
  if (opening === null) return { data: {}, body: source.trim() };
  const rest = source.slice(opening[0].length);
  const closing = CLOSING.exec(rest);
  if (closing === null) return { data: {}, body: source.trim() };

  const header = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length).replace(/^\n/, '').trim();
  const data: Record<string, string | string[]> = {};
  let pending: string | null = null;

  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ') && pending !== null) {
      const item = unquote(trimmed.slice(2));
      if (item.length === 0) continue;
      const list = data[pending];
      if (Array.isArray(list)) list.push(item);
      else data[pending] = [item];
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    pending = null;
    if (key.length === 0) continue;
    if (value.length === 0) {
      data[key] = [];
      pending = key;
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = splitList(value.slice(1, -1));
      continue;
    }
    data[key] = unquote(value);
  }

  return { data, body };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `*` within a segment, `**` across segments, `?` one character, `{a,b}` alternates. */
function globRegExp(pattern: string): RegExp {
  let out = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index + 1);
      if (close < 0) {
        out += '\\{';
        continue;
      }
      const options = pattern
        .slice(index + 1, close)
        .split(',')
        .map((option) => escapeRegExp(option.trim()))
        .join('|');
      out += `(?:${options})`;
      index = close;
      continue;
    }
    out += escapeRegExp(char ?? '');
  }
  return new RegExp(`^${out}$`);
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** True when `candidate`, a path-like token, matches `glob`. */
export function matchesGlob(glob: string, candidate: string): boolean {
  const pattern = normalizePathLike(glob.trim());
  const target = normalizePathLike(candidate.trim());
  if (pattern.length === 0 || target.length === 0) return false;
  const expression = globRegExp(pattern);
  if (expression.test(target)) return true;
  if (pattern.includes('/')) return false;
  const base = target.slice(target.lastIndexOf('/') + 1);
  return expression.test(base);
}

const TOKEN_SEPARATORS = /[\s"'`()[\]{}<>,;]+/;
const LEADING_PUNCTUATION = /^[.:@]+/;
const TRAILING_PUNCTUATION = /[.:!?]+$/;
const FILE_NAME = /^[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/;

function looksLikePath(token: string): boolean {
  if (token.includes('/') || token.includes('\\')) return true;
  return FILE_NAME.test(token);
}

/**
 * Path-like tokens in a message: anything with a separator, or a bare file name.
 * Punctuation around a token is stripped, so `` `src/app.ts` `` and `src/app.ts,` both
 * yield `src/app.ts`.
 */
export function pathTokens(message: string): string[] {
  const tokens: string[] = [];
  for (const raw of message.split(TOKEN_SEPARATORS)) {
    const token = raw.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '');
    if (token.length === 0 || !looksLikePath(token)) continue;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function flag(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  const one = Array.isArray(value) ? value[0] : value;
  if (one === undefined) return false;
  return ['true', 'yes', '1'].includes(one.trim().toLowerCase());
}

function globList(value: string | string[] | undefined): string[] | null {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value : splitList(value);
  const globs = raw.map(normalizePathLike).filter((glob) => glob.length > 0);
  return globs.length === 0 ? null : globs;
}

function descriptionOf(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const text = (Array.isArray(value) ? value.join(' ') : value).replace(/\s+/g, ' ').trim();
  return text.length === 0 ? null : text.slice(0, MAX_DESCRIPTION_CHARS);
}

function appliesTo(globs: string[] | null, always: boolean, message: string): boolean {
  if (always || globs === null) return true;
  const tokens = pathTokens(message);
  return globs.some((glob) => tokens.some((token) => matchesGlob(glob, token)));
}

function capBody(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const normalized = text.trim();
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  const window = normalized.slice(0, maxChars);
  const newline = window.lastIndexOf('\n');
  const space = window.lastIndexOf(' ');
  const cut = Math.max(newline, space);
  const kept = (cut > maxChars / 2 ? window.slice(0, cut) : window).trimEnd();
  return { text: `${kept}\n\n[... truncated at ${maxTokens} tokens]`, truncated: true };
}

function renderRule(rule: ProjectRule): string {
  const description = rule.description === null ? '' : `\n_${rule.description}_`;
  return `### ${rule.path}${description}\n${rule.text}`;
}

/** Candidate paths in stable order: AGENTS.md, CLAUDE.md, then `.tuffcode/rules`. */
function rulePaths(root: string): string[] {
  const paths: string[] = [...ALWAYS_FILES];
  try {
    const names = readdirSync(resolve(root, '.tuffcode', 'rules'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
      .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const name of names) paths.push(`${RULES_DIR}/${name}`);
  } catch {
    // No rules directory, or it is unreadable; the always files still apply.
  }
  return paths;
}

function realRootOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** File contents, or null when the file is missing, not a file, or escapes the root. */
function readRuleSource(root: string, realRoot: string, relativePath: string): string | null {
  try {
    const absolute = resolve(root, relativePath);
    if (!isInside(root, absolute)) return null;
    const real = realpathSync(absolute);
    if (!isInside(realRoot, real)) return null;
    if (!statSync(real).isFile()) return null;
    const fd = openSync(real, 'r');
    try {
      const size = statSync(real).size;
      const length = Math.min(size, MAX_RULE_FILE_BYTES);
      const buffer = Buffer.alloc(length);
      const read = readSync(fd, buffer, 0, length, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function renderPlan(
  rules: readonly ProjectRule[],
  skipped: readonly string[],
  truncated: readonly string[],
): string {
  const blocks = rules.map(renderRule);
  if (truncated.length > 0) blocks.push(`Truncated to fit: ${truncated.join(', ')}`);
  if (skipped.length > 0) blocks.push(`Skipped for length: ${skipped.join(', ')}`);
  return blocks.join('\n\n');
}

/**
 * Rules that apply to `message`, already rendered and inside the section budget.
 * Reading never throws: an unreadable rule is simply absent.
 */
export function loadProjectRules(projectPath: string, message: string): ProjectRulesPlan {
  const root = resolve(projectPath);
  const realRoot = realRootOf(root);
  const bodyBudget = PROJECT_RULES_TOKEN_BUDGET - MARKER_RESERVE_TOKENS;
  const rules: ProjectRule[] = [];
  const skipped: string[] = [];
  const truncated: string[] = [];
  let used = 0;

  for (const relativePath of rulePaths(root)) {
    const source = readRuleSource(root, realRoot, relativePath);
    if (source === null) continue;
    const frontmatter = parseRuleFrontmatter(source);
    const globs = globList(frontmatter.data['globs']);
    if (!appliesTo(globs, flag(frontmatter.data['alwaysapply']), message)) continue;
    if (frontmatter.body.length === 0) continue;
    const capped = capBody(frontmatter.body, PROJECT_RULE_TOKEN_BUDGET);
    const rule: ProjectRule = {
      path: relativePath,
      description: descriptionOf(frontmatter.data['description']),
      globs,
      text: capped.text,
      truncated: capped.truncated,
    };
    const cost = estimateTokens(renderRule(rule));
    if (used + cost > bodyBudget) {
      skipped.push(relativePath);
      continue;
    }
    used += cost;
    rules.push(rule);
    if (capped.truncated) truncated.push(relativePath);
  }

  let text = renderPlan(rules, skipped, truncated);
  while (estimateTokens(text) > PROJECT_RULES_TOKEN_BUDGET && rules.length > 0) {
    const dropped = rules.pop();
    if (dropped === undefined) break;
    skipped.unshift(dropped.path);
    const index = truncated.indexOf(dropped.path);
    if (index >= 0) truncated.splice(index, 1);
    text = renderPlan(rules, skipped, truncated);
  }
  if (rules.length === 0) text = '';

  return { rules, skipped, text, tokens: estimateTokens(text) };
}
