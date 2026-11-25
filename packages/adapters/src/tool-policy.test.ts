import { describe, expect, it } from 'vitest';
import { allowedToolSchemas } from './tool-policy.js';

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
