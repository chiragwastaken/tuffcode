import type { BrainEntry, BrainSlice, ExecutionMode, Settings } from '@tuffcode/contracts';
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
  /** Why each injected id made the slice; the prompt preview renders this. */
  reasons: Record<string, string>;
}

function alwaysReason(entry: BrainEntry): string {
  switch (entry.kind) {
    case 'identity':
      return 'identity block';
    case 'rule':
      return entry.appliesTo === null || entry.appliesTo === 'all'
        ? 'standing rule for every turn'
        : `standing rule for ${entry.appliesTo}`;
    case 'preference':
      return 'preference';
    case 'project':
      return 'project entry';
    case 'working-note':
      return 'working note';
    default:
      return 'memory entry';
  }
}

function retrievedReason(entry: BrainEntry): string {
  return `retrieved for the message (importance ${entry.importance.toFixed(2)})`;
}

/**
 * Per-turn brain assembly. `settings.brainEnabled` is the global kill switch: when it
 * is off the turn injects nothing at all, including the always block. Each injected id
 * carries a reason so the prompt preview can explain the slice.
 */
export function assembleBrain(
  repos: Repos,
  settings: Settings,
  input: BrainAssemblyInput,
): BrainAssembly {
  if (!settings.brainEnabled) {
    return { slice: { always: [], retrieved: [], tokens: 0 }, injectedIds: [], tokens: 0, reasons: {} };
  }
  const selection = selectBrain(repos.brain, {
    projectId: input.projectId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    message: input.message,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const injectedIds = [...selection.slice.always, ...selection.slice.retrieved].map(
    (entry) => entry.id,
  );
  const reasons: Record<string, string> = {};
  for (const entry of selection.slice.always) reasons[entry.id] = alwaysReason(entry);
  for (const entry of selection.slice.retrieved) reasons[entry.id] = retrievedReason(entry);
  return { slice: selection.slice, injectedIds, tokens: selection.slice.tokens, reasons };
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
