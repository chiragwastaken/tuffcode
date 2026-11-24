/**
 * Prompt planning for one turn: brain selection plus the shared assembler.
 *
 * The runner and `prompt.preview` both call `planPrompt`, so what the preview shows is
 * byte-for-byte what the adapter receives. Nothing here reads planning documents or
 * any file outside the repository state; the only user-authored input is
 * `settings.customInstructions`.
 */
import type { Project, Settings, Thread } from '@tuffcode/contracts';
import { assemblePrompt, type AssembledPrompt } from '@tuffcode/prompt';
import { assembleBrain, type BrainAssembly } from '../brain/service.js';
import { renderBrainEntries } from '../brain/selector.js';
import type { Repos } from '../db/repos/index.js';

export interface PromptPlanInput {
  thread: Thread;
  project: Project;
  /** The user message for this turn; it is the last section, not the system prompt. */
  message: string;
  settings: Settings;
  now?: Date;
}

export interface PromptPlan {
  assembly: AssembledPrompt;
  brain: BrainAssembly;
}

export function planPrompt(repos: Repos, input: PromptPlanInput): PromptPlan {
  const { thread, project, message, settings } = input;
  const now = input.now ?? new Date();
  const brain = assembleBrain(repos, settings, {
    projectId: project.id,
    threadId: thread.id,
    mode: thread.executionMode,
    message,
    now,
  });

  const assembly = assemblePrompt({
    customInstructions: settings.customInstructions,
    brainAlways: renderBrainEntries(brain.slice.always),
    retrievedMemory: renderBrainEntries(brain.slice.retrieved),
    turnContext: {
      date: now.toISOString().slice(0, 10),
      mode: thread.executionMode,
      cwd: thread.worktreePath ?? project.path,
      projectName: project.name,
      brainSlice: '',
    },
    userMessage: message,
  });

  return { assembly, brain };
}
