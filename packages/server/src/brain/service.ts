import type { BrainSlice, ExecutionMode, Settings } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { selectBrain } from './selector.js';

export interface BrainAssemblyInput {
  projectId: string;
  threadId?: string;
  mode?: ExecutionMode;
  message: string;
  now?: Date;
}

export interface BrainAssembly {
  slice: BrainSlice;
  /** Every entry id the turn injects, in injection order. */
  injectedIds: string[];
  tokens: number;
}

/**
 * Per-turn brain assembly. Honors the global kill switch for retrieval only: the
 * always block (identity, rules, project, working note) is never skipped.
 */
export function assembleBrain(
  repos: Repos,
  settings: Settings,
  input: BrainAssemblyInput,
): BrainAssembly {
  const selection = selectBrain(repos.brain, {
    projectId: input.projectId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    message: input.message,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    retrieval: settings.brainEnabled,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const injectedIds = [...selection.slice.always, ...selection.slice.retrieved].map(
    (entry) => entry.id,
  );
  return { slice: selection.slice, injectedIds, tokens: selection.slice.tokens };
}

function entryLine(entry: BrainSlice['always'][number]): string {
  const tags = entry.tags.trim();
  return tags.length === 0 ? `[${entry.kind}] ${entry.text}` : `[${entry.kind}] ${entry.text} (${tags})`;
}

/**
 * Renders the brain slice handed to the adapter. Rules are omitted because they are
 * already part of the system prompt through `extraRules`; injecting them twice
 * wastes tokens and confuses the model.
 */
export function renderBrainSlice(slice: BrainSlice): string {
  return [...slice.always, ...slice.retrieved]
    .filter((entry) => entry.kind !== 'rule')
    .map(entryLine)
    .join('\n');
}
