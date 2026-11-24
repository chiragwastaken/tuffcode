/**
 * One prompt assembly path shared by the turn runner and `prompt.preview`.
 *
 * Section order is fixed: base prompt, custom instructions, brain always block,
 * retrieved memory, turn context, user message. Empty optional sections are omitted,
 * so a preview can never show a heading the adapter never receives. Everything except
 * the user message is joined into the system prompt; the user message travels as the
 * turn text.
 */
import { BASE_SYSTEM_PROMPT } from './base';
import { buildTurnContext, estimateTokens, type TurnContextInput } from './context';
import { buildCustomInstructions } from './custom';

export const CUSTOM_INSTRUCTIONS_HEADING = '## Custom instructions';

export type PromptSectionName =
  | 'base'
  | 'custom-instructions'
  | 'brain-always'
  | 'retrieved-memory'
  | 'turn-context'
  | 'user-message';

export interface PromptSection {
  name: PromptSectionName;
  text: string;
  tokens: number;
}

export interface PromptAssemblyInput {
  /** Raw `settings.customInstructions`; trimmed and capped here. */
  customInstructions?: string;
  /** Rendered brain always block: identity, rules, preferences, project, note. */
  brainAlways?: string;
  /** Rendered memory entries retrieved for this turn. */
  retrievedMemory?: string;
  turnContext: TurnContextInput;
  userMessage: string;
}

export interface AssembledPrompt {
  sections: PromptSection[];
  /** Every section except the user message, in assembly order. */
  systemPrompt: string;
  /** Tokens across all sections, the user message included. */
  total: number;
}

function section(name: PromptSectionName, text: string): PromptSection {
  return { name, text, tokens: estimateTokens(text) };
}

export function assemblePrompt(input: PromptAssemblyInput): AssembledPrompt {
  const custom = buildCustomInstructions(input.customInstructions ?? '');
  const brainAlways = input.brainAlways?.trim() ?? '';
  const retrieved = input.retrievedMemory?.trim() ?? '';

  const sections = [section('base', BASE_SYSTEM_PROMPT)];
  if (custom !== undefined) {
    sections.push(section('custom-instructions', `${CUSTOM_INSTRUCTIONS_HEADING}\n${custom}`));
  }
  if (brainAlways.length > 0) sections.push(section('brain-always', brainAlways));
  if (retrieved.length > 0) sections.push(section('retrieved-memory', retrieved));
  sections.push(section('turn-context', buildTurnContext(input.turnContext)));
  sections.push(section('user-message', input.userMessage));

  return {
    sections,
    systemPrompt: sections
      .filter((entry) => entry.name !== 'user-message')
      .map((entry) => entry.text)
      .join('\n\n'),
    total: sections.reduce((sum, entry) => sum + entry.tokens, 0),
  };
}
