import { estimateTokens } from '@tuffcode/prompt';
import type { SkillSummary } from './discover.js';

/**
 * Skill injection for one turn. `$name` in the message loads that skill's body now
 * (bounded); every other skill is listed by name and description only, and the model
 * loads a body on demand with the `skill` tool. Bodies stay on disk until needed.
 */
export const SKILL_BODY_TOKEN_BUDGET = 6000;
export const AVAILABLE_SKILLS_TOKEN_BUDGET = 400;
export const AVAILABLE_SKILLS_LIMIT = 30;

const MENTION = /(^|[\s(])\$([A-Za-z0-9][A-Za-z0-9_-]*)/g;

export interface ExpandedSkill {
  name: string;
  body: string;
}

export interface SkillExpansion {
  sections: ExpandedSkill[];
  /** Mentions that name no discovered skill, in message order. */
  unknown: string[];
  /** Mentions skipped because the body budget was spent. */
  skipped: string[];
}

/** Names mentioned with `$`, deduplicated, in message order. */
export function skillMentions(message: string): string[] {
  const names: string[] = [];
  for (const match of message.matchAll(MENTION)) {
    const name = match[2];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

export function expandSkillMentions(
  message: string,
  skills: readonly SkillSummary[],
  readBody: (skill: SkillSummary) => string,
  budgetTokens = SKILL_BODY_TOKEN_BUDGET,
): SkillExpansion {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const expansion: SkillExpansion = { sections: [], unknown: [], skipped: [] };
  let used = 0;
  for (const name of skillMentions(message)) {
    const skill = byName.get(name);
    if (skill === undefined) {
      // A dollar amount like $5 or a shell variable is not a skill; only report words.
      if (/[A-Za-z]/.test(name)) expansion.unknown.push(name);
      continue;
    }
    let body: string;
    try {
      body = readBody(skill).trim();
    } catch {
      expansion.unknown.push(name);
      continue;
    }
    const cost = estimateTokens(body);
    if (used + cost > budgetTokens) {
      expansion.skipped.push(name);
      continue;
    }
    used += cost;
    expansion.sections.push({ name, body });
  }
  return expansion;
}

export function renderSkillSections(sections: readonly ExpandedSkill[]): string {
  return sections.map((section) => `### Skill: ${section.name}\n${section.body}`).join('\n\n');
}

/** "- name: description" lines for skills not already expanded, within the list budget. */
export function availableSkillsList(
  skills: readonly SkillSummary[],
  expanded: readonly string[] = [],
): string {
  const lines: string[] = [];
  let used = 0;
  for (const skill of skills) {
    if (expanded.includes(skill.name)) continue;
    if (lines.length >= AVAILABLE_SKILLS_LIMIT) break;
    const description = skill.description.replace(/\s+/g, ' ').trim();
    const line = `- ${skill.name}: ${description.length > 160 ? `${description.slice(0, 157)}...` : description}`;
    const cost = estimateTokens(line);
    if (used + cost > AVAILABLE_SKILLS_TOKEN_BUDGET) break;
    used += cost;
    lines.push(line);
  }
  return lines.join('\n');
}
