/**
 * Per-turn context block appended after the system prompt.
 *
 * The block is small and bounded: whatever the brain assembly produces, the
 * rendered block never exceeds the context token budget.
 */

export type ExecutionMode = 'plan' | 'work' | 'council';

export interface TurnContextInput {
  /** Calendar date in ISO form, for example 2026-11-24. */
  date: string;
  mode: ExecutionMode;
  /** Absolute path of the worktree the turn runs in. */
  cwd: string;
  /** Brain entries selected for this turn, already rendered to text. */
  brainSlice: string;
  projectName: string;
}

/** 200 tokens at four characters per token, with headroom for rounding. */
const MAX_CONTEXT_CHARS = 760;
const TRUNCATION = '...';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRUNCATION.length) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - TRUNCATION.length)}${TRUNCATION}`;
}

export function buildTurnContext(input: TurnContextInput): string {
  const date = truncate(collapse(input.date), 32);
  const project = truncate(collapse(input.projectName), 64);
  const cwd = truncate(collapse(input.cwd), 200);
  const brain = collapse(input.brainSlice);

  const lines = [
    '<context>',
    `date: ${date}`,
    `mode: ${input.mode}`,
    `project: ${project}`,
    `cwd: ${cwd}`,
  ];
  const closing = '</context>';
  const fixedLength = [...lines, closing].join('\n').length;

  if (brain.length > 0) {
    const prefix = '\nbrain: ';
    const budget = MAX_CONTEXT_CHARS - fixedLength - prefix.length;
    if (budget > TRUNCATION.length) {
      lines.push(`brain: ${truncate(brain, budget)}`);
    }
  }

  lines.push(closing);
  return lines.join('\n');
}
