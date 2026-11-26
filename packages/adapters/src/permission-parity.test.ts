import { describe, expect, it } from 'vitest';
import type { PermissionMode } from '@tuffcode/contracts';
import { decidePermission, type PermissionVerdict } from './acp/translate.js';
import { mapPermissionMode, type ClaudePermissionMode } from './claude/adapter.js';
import {
  codexApprovalPolicy,
  codexSandboxMode,
  type CodexApprovalPolicy,
  type CodexSandboxMode,
} from './codex/adapter.js';
import { classifyExtraTool, classifyTool, type PermissionDecision } from './openai/tools.js';

/**
 * One promise, four modes, five surfaces. Each adapter can only express part of a mode
 * (Claude names a mode, Codex names a sandbox and an approval policy, ACP names a verdict
 * per tool kind), so this table records what each surface owes the user and the tests
 * below hold every surface to the same row.
 */
interface ModeRow {
  mode: PermissionMode;
  /** Harness: verdict for a file write, an arbitrary shell command, and a read. */
  write: PermissionDecision;
  bash: PermissionDecision;
  read: PermissionDecision;
  claude: ClaudePermissionMode;
  approval: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  /** ACP: verdicts for a read kind, an edit kind and an execute kind. */
  acpRead: PermissionVerdict;
  acpEdit: PermissionVerdict;
  acpExecute: PermissionVerdict;
}

const MODES: ModeRow[] = [
  {
    mode: 'read-only',
    write: 'deny',
    bash: 'deny',
    read: 'allow',
    claude: 'plan',
    approval: 'never',
    sandbox: 'read-only',
    acpRead: 'allow',
    acpEdit: 'deny',
    acpExecute: 'deny',
  },
  {
    mode: 'ask',
    write: 'approve',
    bash: 'approve',
    read: 'allow',
    claude: 'default',
    approval: 'on-request',
    sandbox: 'workspace-write',
    acpRead: 'ask',
    acpEdit: 'ask',
    acpExecute: 'ask',
  },
  {
    mode: 'accept-edits',
    write: 'allow',
    bash: 'approve',
    read: 'allow',
    claude: 'acceptEdits',
    approval: 'on-request',
    sandbox: 'workspace-write',
    acpRead: 'allow',
    acpEdit: 'allow',
    acpExecute: 'ask',
  },
  {
    mode: 'full-auto',
    write: 'allow',
    bash: 'allow',
    read: 'allow',
    claude: 'bypassPermissions',
    approval: 'never',
    sandbox: 'danger-full-access',
    acpRead: 'allow',
    acpEdit: 'allow',
    acpExecute: 'allow',
  },
];

describe.each(MODES)('$mode', (row) => {
  it('classifies the harness file tools', () => {
    expect(classifyTool('write', { path: 'notes.txt', content: 'x' }, row.mode)).toBe(row.write);
    expect(classifyTool('edit', { path: 'notes.txt', old: 'a', new: 'b' }, row.mode)).toBe(
      row.write,
    );
    expect(classifyTool('read', { path: 'notes.txt' }, row.mode)).toBe(row.read);
    expect(classifyTool('bash', { command: 'npm test' }, row.mode)).toBe(row.bash);
  });

  it('maps onto a Claude Code permission mode', () => {
    expect(mapPermissionMode(row.mode)).toBe(row.claude);
  });

  it('maps onto a Codex approval policy and sandbox', () => {
    expect(codexApprovalPolicy(row.mode)).toBe(row.approval);
    expect(codexSandboxMode(row.mode)).toBe(row.sandbox);
  });

  it('decides the same thing for an ACP tool kind', () => {
    expect(decidePermission(row.mode, 'read')).toBe(row.acpRead);
    expect(decidePermission(row.mode, 'edit')).toBe(row.acpEdit);
    expect(decidePermission(row.mode, 'execute')).toBe(row.acpExecute);
  });
});

describe('the same promise on every surface', () => {
  it('refuses writes in read-only mode', () => {
    expect(classifyTool('write', { path: 'notes.txt' }, 'read-only')).toBe('deny');
    expect(classifyExtraTool('config', { action: 'settings.set' }, 'read-only')).toBe('deny');
    expect(decidePermission('read-only', 'edit')).toBe('deny');
    expect(codexSandboxMode('read-only')).toBe('read-only');
    expect(mapPermissionMode('read-only')).toBe('plan');
  });

  it('asks before a write in ask mode', () => {
    expect(classifyTool('write', { path: 'notes.txt' }, 'ask')).toBe('approve');
    expect(classifyExtraTool('config', { action: 'settings.set' }, 'ask')).toBe('approve');
    expect(decidePermission('ask', 'edit')).toBe('ask');
    expect(codexApprovalPolicy('ask')).toBe('on-request');
    expect(mapPermissionMode('ask')).toBe('default');
  });

  it('lets accept-edits write files but still asks for an arbitrary command', () => {
    expect(classifyTool('edit', { path: 'notes.txt', old: 'a', new: 'b' }, 'accept-edits')).toBe(
      'allow',
    );
    expect(classifyTool('bash', { command: 'npm test' }, 'accept-edits')).toBe('approve');
    expect(classifyExtraTool('config', { action: 'settings.set' }, 'accept-edits')).toBe('approve');
    expect(decidePermission('accept-edits', 'edit')).toBe('allow');
    expect(decidePermission('accept-edits', 'execute')).toBe('ask');
    expect(codexSandboxMode('accept-edits')).toBe('workspace-write');
    expect(codexApprovalPolicy('accept-edits')).toBe('on-request');
    expect(mapPermissionMode('accept-edits')).toBe('acceptEdits');
  });

  it('lets full-auto run anything except the destructive denylist', () => {
    expect(classifyTool('bash', { command: 'npm test' }, 'full-auto')).toBe('allow');
    expect(classifyTool('bash', { command: 'rm -rf /' }, 'full-auto')).toBe('approve');
    expect(classifyTool('bash', { command: 'git push --force origin main' }, 'full-auto')).toBe(
      'approve',
    );
    expect(classifyTool('write', { path: 'notes.txt' }, 'full-auto')).toBe('allow');
    expect(decidePermission('full-auto', 'execute')).toBe('allow');
    expect(codexSandboxMode('full-auto')).toBe('danger-full-access');
    expect(mapPermissionMode('full-auto')).toBe('bypassPermissions');
  });

  it('keeps the server tools on the file-tool ladder', () => {
    // A memory search changes nothing, and listing MCP servers spawns their binaries.
    expect(classifyExtraTool('memory', { action: 'search' }, 'read-only')).toBe('allow');
    expect(classifyExtraTool('mcp', { action: 'list' }, 'read-only')).toBe('deny');
    expect(classifyExtraTool('mcp', { action: 'list' }, 'ask')).toBe('allow');
    // A fetch reaches the network, so read-only refuses it and ask wants approval.
    const fetchArgs = { url: 'https://example.com' };
    expect(classifyExtraTool('web_fetch', fetchArgs, 'read-only')).toBe('deny');
    expect(classifyExtraTool('web_fetch', fetchArgs, 'ask')).toBe('approve');
    expect(classifyExtraTool('web_fetch', fetchArgs, 'full-auto')).toBe('allow');
    // The task list only changes Tuffcode's own state.
    expect(classifyExtraTool('todo', { op: 'view' }, 'read-only')).toBe('allow');
  });
});
