import type { BrainEntry } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { createBrainStore, type BrainStore } from './store.js';

/** Standing-rule phrase from spec section 8, step 4. */
export const STANDING_RULE_PATTERN = /always remember[:\s]+(.+)/i;

/** Every phrase that turns a sentence into a standing rule, D49. */
const RULE_PHRASES: readonly RegExp[] = [/\bfrom now on\b/i, /\bnever use\b/i, /\balways use\b/i];

const RULE_IMPORTANCE = 0.9;
const RULE_SCAN_LIMIT = 300;

export interface CaptureStandingRuleInput {
  message: string;
  projectId?: string | null;
}

export interface CaptureStandingRulesInput {
  text: string;
  projectId?: string | null;
  threadId?: string | null;
}

/** Comparison key: whitespace collapsed, trailing punctuation dropped, lowercased. */
function normalizeRuleText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').toLowerCase();
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * The rule text for one sentence. `always remember` quotes the remainder; the other
 * phrases are the rule itself, so the sentence is stored whole.
 */
function ruleTextOf(sentence: string): string | null {
  const remembered = STANDING_RULE_PATTERN.exec(sentence);
  if (remembered !== null) {
    const quoted = (remembered[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?]+$/, '')
      .trim();
    return quoted.length === 0 ? null : quoted;
  }
  for (const phrase of RULE_PHRASES) {
    if (phrase.test(sentence)) return sentence.replace(/[.!?]+$/, '').trim();
  }
  return null;
}

function projectFor(repos: Repos, input: CaptureStandingRulesInput): string | null {
  if (input.projectId !== undefined) return input.projectId;
  if (input.threadId === undefined || input.threadId === null) return null;
  return repos.threads.get(input.threadId)?.projectId ?? null;
}

/**
 * Extracts a standing rule from a chat message and stores it as a rule that applies
 * to every turn. Returns the stored entry, or null when the message is not a rule.
 */
export function captureStandingRule(
  store: BrainStore,
  input: CaptureStandingRuleInput,
): BrainEntry | null {
  const match = STANDING_RULE_PATTERN.exec(input.message);
  if (match === null) return null;
  const quoted = match[1]?.replace(/\s+/g, ' ').trim() ?? '';
  if (quoted.length === 0) return null;
  return store.upsert({
    kind: 'rule',
    scope: 'global',
    projectId: input.projectId ?? null,
    text: quoted,
    appliesTo: 'all',
    importance: RULE_IMPORTANCE,
    sourceQuote: input.message.trim(),
  });
}

/**
 * Captures one rule per matched sentence and skips a sentence whose normalized text
 * already exists as an active rule. Returns the ids it created.
 */
export function captureStandingRules(repos: Repos, input: CaptureStandingRulesInput): string[] {
  const store = createBrainStore(repos.brain);
  const existing = new Set(
    store.list({ kind: 'rule', limit: RULE_SCAN_LIMIT }).map((entry) => normalizeRuleText(entry.text)),
  );
  const projectId = projectFor(repos, input);
  const ids: string[] = [];
  for (const sentence of sentencesOf(input.text)) {
    const text = ruleTextOf(sentence);
    if (text === null) continue;
    const normalized = normalizeRuleText(text);
    if (normalized.length === 0 || existing.has(normalized)) continue;
    existing.add(normalized);
    const entry = store.upsert({
      kind: 'rule',
      scope: 'global',
      projectId,
      text,
      appliesTo: 'all',
      importance: RULE_IMPORTANCE,
      sourceQuote: sentence,
    });
    ids.push(entry.id);
  }
  return ids;
}
