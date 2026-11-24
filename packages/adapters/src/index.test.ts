import { describe, expect, it } from 'vitest';
import { createAcpAdapter, createClaudeAdapter, createCodexAdapter } from './index.js';

describe('adapter barrel', () => {
  it('re-exports every adapter factory', () => {
    expect(typeof createClaudeAdapter).toBe('function');
    expect(typeof createCodexAdapter).toBe('function');
    expect(typeof createAcpAdapter).toBe('function');
  });
});
