import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../index.js';
import { createApprovalsRepo, type ApprovalsRepo } from './approvals.js';
import { createBrainRepo, type BrainRepo } from './brain.js';
import { createCheckpointsRepo, type CheckpointsRepo } from './checkpoints.js';
import { createReviewCommentsRepo, type ReviewCommentsRepo } from './comments.js';
import { createCouncilRepo, type CouncilRepo } from './council.js';
import { createEventsRepo, type EventsRepo } from './events.js';
import { createMessagesRepo, type MessagesRepo } from './messages.js';
import { createProjectsRepo, type ProjectsRepo } from './projects.js';
import { createProvidersRepo, type ProvidersRepo } from './providers.js';
import { createSettingsRepo, type SettingsRepo } from './settings.js';
import { createSubagentsRepo, type SubagentsRepo } from './subagents.js';
import { createThreadsRepo, type ThreadsRepo } from './threads.js';
import { createTurnsRepo, type TurnsRepo } from './turns.js';

export interface Repos {
  projects: ProjectsRepo;
  threads: ThreadsRepo;
  events: EventsRepo;
  messages: MessagesRepo;
  checkpoints: CheckpointsRepo;
  comments: ReviewCommentsRepo;
  approvals: ApprovalsRepo;
  providers: ProvidersRepo;
  brain: BrainRepo;
  council: CouncilRepo;
  turns: TurnsRepo;
  subagents: SubagentsRepo;
  settings: SettingsRepo;
  /** Runs `fn` in a transaction on the shared connection; nesting is rejected. */
  transaction<T>(fn: () => T): T;
}

/** Builds every repository over one connection. Repos never open their own. */
export function createRepos(db: DatabaseSync): Repos {
  return {
    projects: createProjectsRepo(db),
    threads: createThreadsRepo(db),
    events: createEventsRepo(db),
    messages: createMessagesRepo(db),
    checkpoints: createCheckpointsRepo(db),
    comments: createReviewCommentsRepo(db),
    approvals: createApprovalsRepo(db),
    providers: createProvidersRepo(db),
    brain: createBrainRepo(db),
    council: createCouncilRepo(db),
    turns: createTurnsRepo(db),
    subagents: createSubagentsRepo(db),
    settings: createSettingsRepo(db),
    transaction: (fn) => transaction(db, fn),
  };
}

export type { ApprovalsRepo } from './approvals.js';
export type { BrainListOptions, BrainRepo, UpsertBrainInput } from './brain.js';
export type { CheckpointsRepo, CreateCheckpointInput } from './checkpoints.js';
export type { CreateReviewCommentInput, ReviewCommentsRepo } from './comments.js';
export type {
  CouncilRepo,
  CreateEscalationInput,
  CreateGoalInput,
  CreateReviewInput,
  CreateTaskInput,
  TaskStatePatch,
} from './council.js';
export type { EventsRepo } from './events.js';
export type { AddMessageInput, MessagesRepo } from './messages.js';
export type { AddProjectInput, ProjectMeta, ProjectsRepo } from './projects.js';
export type {
  ProviderRecord,
  ProvidersRepo,
  ReplaceModelInput,
  UpsertProviderInput,
} from './providers.js';
export type { SettingsRepo } from './settings.js';
export type {
  CreateSubagentInput,
  FinishSubagentInput,
  SubagentRecord,
  SubagentsRepo,
} from './subagents.js';
export { toSubagentView } from './subagents.js';
export type { CreateThreadInput, ThreadsRepo, UpdateThreadInput } from './threads.js';
export type { CreateTurnInput, TurnRecord, TurnsRepo, TurnStatus } from './turns.js';
export { toFtsQuery } from './brain.js';
export { toProviderView } from './providers.js';
