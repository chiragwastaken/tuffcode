import type { Project } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildCreateThreadParams,
  resolveInitialProject,
  workspaceChoices,
  workspaceConsequence,
  workspaceSummary,
} from './new-thread-dialog-model';

function project(id: string, name: string): Project {
  return {
    id,
    name,
    path: `C:/work/${name}`,
    defaultBranch: 'main',
    createdAt: '2026-11-25T10:00:00.000Z',
    lastOpenedAt: '2026-11-25T10:00:00.000Z',
  };
}

const projects = [project('prj_recent', 'recent'), project('prj_old', 'old')];

describe('new thread dialog model', () => {
  it('offers the worktree option only while the capability is on', () => {
    expect(workspaceChoices(true)).toEqual(['folder', 'worktree']);
    expect(workspaceChoices(false)).toEqual(['folder']);
  });

  it('preselects the requested project when it still exists', () => {
    expect(resolveInitialProject(projects, 'prj_old')).toBe('prj_old');
  });

  it('falls back to the most recent project and then to null', () => {
    expect(resolveInitialProject(projects, 'prj_gone')).toBe('prj_recent');
    expect(resolveInitialProject(projects, null)).toBe('prj_recent');
    expect(resolveInitialProject([], 'prj_recent')).toBeNull();
  });

  it('builds a folder create payload with the chosen workspace', () => {
    expect(
      buildCreateThreadParams({
        projectId: 'prj_recent',
        providerId: 'prv_1',
        modelId: 'model-x',
        permissionMode: 'ask',
        workspace: 'folder',
      }),
    ).toEqual({
      projectId: 'prj_recent',
      providerId: 'prv_1',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      workspace: 'folder',
    });
  });

  it('builds a worktree create payload', () => {
    const params = buildCreateThreadParams({
      projectId: 'prj_recent',
      providerId: 'prv_1',
      modelId: 'model-x',
      permissionMode: 'full-auto',
      workspace: 'worktree',
    });
    expect(params.workspace).toBe('worktree');
    expect(params.permissionMode).toBe('full-auto');
  });

  it('summarises the path and branch for each workspace', () => {
    const folder = workspaceSummary(projects[0]!, 'folder');
    expect(folder).toContain('C:/work/recent');
    expect(folder).toContain('main');
    const worktree = workspaceSummary(projects[0]!, 'worktree');
    expect(worktree).toContain('C:/work/recent');
    expect(worktree).toContain('main');
    expect(worktree).toContain('tuffcode/');
    expect(workspaceConsequence('folder')).not.toBe(workspaceConsequence('worktree'));
  });
});
