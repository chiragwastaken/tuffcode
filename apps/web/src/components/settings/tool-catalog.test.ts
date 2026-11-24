import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG, toggleEnabledTool, unknownEnabledTools } from './tool-catalog';

const HARNESS_TOOL_IDS = ['bash', 'read', 'edit', 'write', 'glob', 'grep'];

describe('tool catalog', () => {
  it('describes exactly the harness tools', () => {
    expect(TOOL_CATALOG.map((tool) => tool.id)).toEqual(HARNESS_TOOL_IDS);
    for (const tool of TOOL_CATALOG) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('keeps catalog order when enabling a tool out of order', () => {
    expect(toggleEnabledTool(['read', 'bash'], 'glob', true)).toEqual(['bash', 'read', 'glob']);
  });

  it('removes a tool and leaves the rest ordered', () => {
    expect(toggleEnabledTool(['bash', 'read', 'edit'], 'read', false)).toEqual(['bash', 'edit']);
  });

  it('is a no-op when the state already matches', () => {
    expect(toggleEnabledTool(['bash'], 'bash', true)).toEqual(['bash']);
    expect(toggleEnabledTool(['bash'], 'glob', false)).toEqual(['bash']);
  });

  it('preserves ids this build does not know', () => {
    expect(toggleEnabledTool(['bash', 'mystery'], 'read', true)).toEqual([
      'bash',
      'read',
      'mystery',
    ]);
    expect(unknownEnabledTools(['bash', 'mystery'])).toEqual(['mystery']);
  });
});
