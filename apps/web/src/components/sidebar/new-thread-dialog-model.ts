import type { PermissionMode, Project, RpcParams } from '@tuffcode/contracts';

/** Where the new thread runs: the project folder itself, or an isolated worktree. */
export type WorkspaceChoice = 'folder' | 'worktree';

/**
 * The workspace options the dialog offers. Folder mode always exists; the isolated
 * worktree only exists while the Worktrees capability is on.
 */
export function workspaceChoices(worktreesEnabled: boolean): readonly WorkspaceChoice[] {
  return worktreesEnabled ? ['folder', 'worktree'] : ['folder'];
}

/**
 * The project the dialog opens on: the caller's project when it still exists, else
 * the most recent one. `projects` arrives most-recent-first from the server.
 */
export function resolveInitialProject(
  projects: readonly Project[],
  preferredProjectId: string | null,
): string | null {
  if (
    preferredProjectId !== null &&
    projects.some((project) => project.id === preferredProjectId)
  ) {
    return preferredProjectId;
  }
  return projects[0]?.id ?? null;
}

/** One short line per option, describing where the thread will run. */
export function workspaceConsequence(workspace: WorkspaceChoice): string {
  return workspace === 'worktree'
    ? 'An isolated checkout on a new tuffcode branch. The project folder stays untouched.'
    : 'Runs in the project folder: edits, terminal, and agent changes land in the checkout.';
}

/**
 * The summary under the options: the concrete path and branch the thread will use.
 * A worktree branch is created with the thread, so it is named by pattern.
 */
export function workspaceSummary(project: Project, workspace: WorkspaceChoice): string {
  return workspace === 'worktree'
    ? `New branch tuffcode/<thread> from ${project.defaultBranch}, outside ${project.path}.`
    : `${project.path} on ${project.defaultBranch}.`;
}

export interface CreateThreadParamsInput {
  projectId: string;
  providerId: string;
  modelId: string;
  permissionMode: PermissionMode;
  workspace: WorkspaceChoice;
}

/** The exact `threads.create` payload for the dialog's Start button. */
export function buildCreateThreadParams(
  input: CreateThreadParamsInput,
): RpcParams<'threads.create'> {
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    executionMode: 'work',
    permissionMode: input.permissionMode,
    workspace: input.workspace,
  };
}
