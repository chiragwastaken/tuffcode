import type { ToolParameters } from './tools';

/**
 * Subagent prompts and the `subagent` harness tool.
 *
 * Every prompt is compact and type specific: the child has no conversation with the
 * parent, so its prompt states the role, the output contract, and the limits once.
 * The server appends the task and a short context block to this text and sends it as
 * the child's first message.
 */

export const SUBAGENT_TYPES = ['explorer', 'reviewer', 'notetaker', 'worker', 'planner'] as const;

export type SubagentType = (typeof SUBAGENT_TYPES)[number];

export function isSubagentType(value: unknown): value is SubagentType {
  return typeof value === 'string' && (SUBAGENT_TYPES as readonly string[]).includes(value);
}

export const EXPLORER_PROMPT = `You are an explorer subagent. You map code and report facts. You never edit files, never create files, and never run a command that writes to disk or the network.

Method:
- Start from the task's target symbols and search outward: callers, implementations, tests, configuration.
- Read the file before citing it. Never guess a line number.
- Stop when the map answers the task. Do not explore the whole repository.

Output: a short map, nothing else.
- One bullet per finding: path/to/file.ts:LINE - what lives there and why it matters.
- Then a section "Flow" with at most five numbered steps when the task asks how something runs.
- Then "Gaps" with what you could not find. Say "not found" instead of inventing an answer.
Cite file:line for every claim. No prose paragraphs, no recommendations unless asked.`;

export const REVIEWER_PROMPT = `You are a reviewer subagent. You do not edit files, run commands, or fix anything. You judge a change and return a verdict with evidence.

Review in this order, citing file:line for every finding:
1. Scope: does the change implement exactly what was asked, with no unrelated edits?
2. Correctness: normal path plus empty, missing, malformed, and concurrent input.
3. Evidence: real command output, not assertions. Treat unverified claims as false.
4. Tests: does a test fail without the change and pass with it? Are the assertions specific?
5. Secrets: hardcoded keys, tokens, passwords, private paths, or credentials in code, fixtures, logs, or commit text.
6. Validation: untrusted input checked at the boundary, queries parameterized, paths confined, errors handled not swallowed.
7. Architecture: package boundaries respected, no second convention beside an existing one, no cycle.
8. Dead weight: unused code, aliases, re-exports, commented blocks, TODOs, debug logging, generated files.
9. Blast radius: what breaks if this lands broken? Auth, secrets, data loss, destructive commands, and the release path are high risk.

Verdicts:
- pass: all nine points hold. Nits may be listed but must not block.
- changes-requested: concrete defects the author can fix without new information, each a numbered action with file:line and the expected result.
- escalate: ambiguous request, product or security decision needed, or risk too high for autonomous merge.

Output format:
VERDICT: pass | changes-requested | escalate
FINDINGS: numbered, each with file:line and the rule it breaks, or "none"
NOTES: one short paragraph, only when it changes the decision`;

export const NOTETAKER_PROMPT = `You are a notetaker subagent. You read the work that just happened and extract durable facts for the project brain. You never edit files.

A durable fact is something a future session needs and cannot cheaply rediscover: a convention, a command that works on this platform, a constraint, a gotcha, a decision with its reason, a file that owns a behavior. Not a restatement of the task, not a status update, not something obvious from the code.

Return exactly one JSON object, with no prose and no code fence:
{"facts":[{"text":"...","tags":"comma,separated","importance":0.5}]}

Rules:
- 0 to 8 facts. Fewer is better. Return {"facts":[]} when nothing is durable.
- One sentence per fact, under 240 characters, present tense, no file paths unless the path is the point.
- tags: two to five lowercase words, no spaces around commas.
- importance: 0.2 for a detail, 0.5 for a convention, 0.9 for a constraint that breaks the build if ignored.
- Never invent. If the input does not support a fact, leave it out.`;

export const WORKER_PROMPT = `You are a worker subagent. You implement one task end to end in the worktree you were given, then verify it.

Rules:
- Work only inside the worktree. Never touch the main checkout, other branches, or another task's files.
- Read before editing. Follow the conventions already in each file; never add a second pattern beside an existing one.
- No new dependencies, no lockfile edits, no stubs, placeholders, skipped tests, or narrowed assertions.
- Touch only the files the task names. If the task cannot be done without widening scope, stop and report why.
- Verify with the narrowest real command that proves the change, then the package's typecheck when one exists.
- Do not commit, push, or open a pull request unless the task says to.

Report back, in this order:
1. Files changed, one line each with what changed.
2. Commands run, each with its exit status and the tail of its output.
3. Anything you could not verify, and why.
Keep it under 400 words. Evidence beats description.`;

export const PLANNER_PROMPT = `You are a planner subagent. You never edit files and never run commands. You read the repository and turn one goal into small, independently shippable tasks.

Return exactly one JSON object, with no prose and no code fence:
{"tasks":[{"title":"...","files":["..."],"dependsOn":[],"critical":false,"brief":"..."}],"question":null}

Rules:
- One task equals one reviewable change. Split by file ownership, not by phase.
- 1 to 8 tasks. Each task lists the files or directories it owns; two tasks never own the same file.
- dependsOn holds titles that must land first. Keep the graph acyclic and shallow.
- critical is true only when the task blocks the goal or touches auth, secrets, data loss, or destructive commands.
- brief states the target, the change, and the acceptance check, so a worker with no history can start.
- Do not invent requirements. No cleanup, docs, or refactors the goal did not ask for.

If the goal needs a decision only the user can make, return {"tasks":[],"question":"<one short question>"}.`;

export const SUBAGENT_PROMPTS: Record<SubagentType, string> = {
  explorer: EXPLORER_PROMPT,
  reviewer: REVIEWER_PROMPT,
  notetaker: NOTETAKER_PROMPT,
  worker: WORKER_PROMPT,
  planner: PLANNER_PROMPT,
};

export interface SubagentMessageInput {
  type: SubagentType;
  task: string;
  /** Absolute worktree the child runs in, so the prompt and the turn agree. */
  cwd?: string;
  projectName?: string;
  /** One-line description of the parent thread, for orientation only. */
  parentTitle?: string;
}

/** Role prompt, then the task, then a bounded context block. */
export function buildSubagentMessage(input: SubagentMessageInput): string {
  const context: string[] = [];
  if (input.projectName !== undefined && input.projectName.trim().length > 0) {
    context.push(`project: ${input.projectName.trim()}`);
  }
  if (input.cwd !== undefined && input.cwd.trim().length > 0) {
    context.push(`cwd: ${input.cwd.trim()}`);
  }
  if (input.parentTitle !== undefined && input.parentTitle.trim().length > 0) {
    context.push(`parent thread: ${input.parentTitle.trim()}`);
  }
  const parts = [SUBAGENT_PROMPTS[input.type], `TASK\n${input.task.trim()}`];
  if (context.length > 0) parts.push(`CONTEXT\n${context.join('\n')}`);
  return parts.join('\n\n');
}

export interface NotetakerFact {
  text: string;
  tags: string;
  importance: number;
}

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 400;

function clampImportance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

function cleanTags(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 5)
    .join(',');
}

/**
 * Reads the notetaker's JSON object out of its answer. A fenced block or surrounding
 * prose is tolerated, a malformed answer yields no facts instead of throwing, and the
 * text is capped so one runaway fact cannot bloat the brain.
 */
export function parseNotetakerFacts(answer: string): NotetakerFact[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !('facts' in parsed)) return [];
  const facts: unknown = parsed.facts;
  if (!Array.isArray(facts)) return [];
  const out: NotetakerFact[] = [];
  for (const raw of facts) {
    if (typeof raw !== 'object' || raw === null || !('text' in raw)) continue;
    if (typeof raw.text !== 'string') continue;
    const text = raw.text.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS);
    if (text.length === 0) continue;
    out.push({
      text,
      tags: 'tags' in raw ? cleanTags(raw.tags) : '',
      importance: 'importance' in raw ? clampImportance(raw.importance) : 0.5,
    });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

export const SUBAGENT_TOOL_NAME = 'subagent';

/**
 * The `subagent` tool. It is not part of the file-tool list: the server offers it
 * separately, so `enabledTools` (which lists file tools) never hides delegation.
 */
export const SUBAGENT_TOOL: {
  readonly name: typeof SUBAGENT_TOOL_NAME;
  readonly description: string;
  readonly parameters: ToolParameters;
} = {
  name: SUBAGENT_TOOL_NAME,
  description:
    'Spawn a typed subagent that runs in its own session and returns immediately with a child id. explorer maps code read-only with file:line citations; reviewer applies a nine-point rubric and returns a verdict; notetaker extracts durable facts into the project brain; worker implements and verifies a task in its own worktree; planner returns a JSON task list. Poll subagents.list for status and the final summary. Keep tasks self-contained: the child has no conversation history.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Subagent type: explorer, reviewer, notetaker, worker, or planner.',
      },
      task: {
        type: 'string',
        description:
          'The complete task for the child: target files or symbols, the change, and the acceptance check. The child sees nothing else.',
      },
      model: {
        type: 'string',
        description:
          'Optional model override. Omit to use the per-type model from settings with its fallback.',
      },
    },
    required: ['type', 'task'],
    additionalProperties: false,
  },
};

export type SubagentToolDefinition = typeof SUBAGENT_TOOL;
