import { describe, expect, it } from 'vitest';
import { allowedToolSchemas, RepeatedToolCallGuard } from './tool-policy.js';

describe('allowedToolSchemas', () => {
  it('offers the six core tools when the allowlist is unset', () => {
    expect(allowedToolSchemas().map((tool) => tool.name)).toEqual([
      'bash',
      'read',
      'edit',
      'write',
      'glob',
      'grep',
    ]);
  });

  it('filters the core tools by the allowlist', () => {
    expect(allowedToolSchemas(['read', 'grep']).map((tool) => tool.name)).toEqual([
      'read',
      'grep',
    ]);
  });

  it('adds the subagent tool outside the allowlist', () => {
    expect(allowedToolSchemas(['read'], { subagent: true }).map((tool) => tool.name)).toEqual([
      'read',
      'subagent',
    ]);
  });

  it('offers the extra tools only when a runner is injected', () => {
    expect(allowedToolSchemas(['read']).map((tool) => tool.name)).not.toContain('mcp');
    expect(allowedToolSchemas(['read'], { extra: true }).map((tool) => tool.name)).toEqual([
      'read',
      'mcp',
      'memory',
      'config',
    ]);
  });

  it('keeps the subagent and extra tools outside a narrowed allowlist', () => {
    expect(
      allowedToolSchemas(['read'], { subagent: true, extra: true }).map((tool) => tool.name),
    ).toEqual(['read', 'subagent', 'mcp', 'memory', 'config']);
  });
});

describe('RepeatedToolCallGuard', () => {
  it('flags the third identical call in a row', () => {
    const guard = new RepeatedToolCallGuard();
    const call = { name: 'read', args: { path: 'a.ts' } };

    expect(guard.observe('', [call])).toBe(false);
    expect(guard.observe('', [call])).toBe(false);
    expect(guard.observe('', [call])).toBe(true);
  });

  it('treats re-ordered argument keys as the same call', () => {
    const guard = new RepeatedToolCallGuard();

    expect(guard.observe('', [{ name: 'write', args: { path: 'a', content: 'x' } }])).toBe(false);
    expect(guard.observe('', [{ name: 'write', args: { content: 'x', path: 'a' } }])).toBe(false);
    expect(guard.observe('', [{ name: 'write', args: { path: 'a', content: 'x' } }])).toBe(true);
  });

  it('resets on new assistant text or a different call', () => {
    const guard = new RepeatedToolCallGuard();
    const call = { name: 'read', args: { path: 'a.ts' } };

    expect(guard.observe('', [call])).toBe(false);
    expect(guard.observe('', [call])).toBe(false);
    expect(guard.observe('trying another file', [call])).toBe(false);
    expect(guard.observe('', [{ name: 'read', args: { path: 'b.ts' } }])).toBe(false);
    expect(guard.observe('', [{ name: 'read', args: { path: 'b.ts' } }])).toBe(false);
    expect(guard.observe('', [{ name: 'read', args: { path: 'b.ts' } }])).toBe(true);
  });
});
