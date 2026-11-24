import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_COLUMNS,
  CAPABILITY_COLUMN_LABEL,
  CAPABILITY_GAPS,
  CAPABILITY_LEVEL_LABEL,
  CAPABILITY_ROWS,
  type CapabilityLevel,
} from './capabilities-matrix';

const LEVELS: readonly CapabilityLevel[] = ['supported', 'partial', 'not-supported'];

describe('capabilities matrix', () => {
  it('has the five columns the spec lists', () => {
    expect(CAPABILITY_COLUMNS).toEqual(['tuffcode', 'claude-code', 'codex', 'cursor', 't3-code']);
    expect(CAPABILITY_COLUMNS.map((column) => CAPABILITY_COLUMN_LABEL[column])).toEqual([
      'Tuffcode',
      'Claude Code',
      'Codex CLI',
      'Cursor',
      'T3 Code',
    ]);
  });

  it('covers the fifteen features in spec order', () => {
    expect(CAPABILITY_ROWS.map((row) => row.id)).toEqual([
      'worktrees',
      'multi-provider',
      'subscription-login',
      'openai-compatible',
      'local-models',
      'council',
      'brain',
      'diff-comments',
      'terminal',
      'checkpoints',
      'draft-pr',
      'slash-commands',
      'skills',
      'conpty',
      'telemetry',
    ]);
  });

  it('gives every row a value and a note for every column', () => {
    for (const row of CAPABILITY_ROWS) {
      expect(row.feature.length).toBeGreaterThan(0);
      expect(Object.keys(row.cells).toSorted()).toEqual([...CAPABILITY_COLUMNS].toSorted());

      for (const column of CAPABILITY_COLUMNS) {
        const value = row.cells[column];
        expect(LEVELS).toContain(value.level);
        expect(value.note.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('labels each level once', () => {
    expect(LEVELS.map((level) => CAPABILITY_LEVEL_LABEL[level])).toEqual([
      'Supported',
      'Partial',
      'Not supported',
    ]);
  });

  it('does not claim every cell is supported', () => {
    const levels = new Set(
      CAPABILITY_ROWS.flatMap((row) => CAPABILITY_COLUMNS.map((column) => row.cells[column].level)),
    );
    expect(levels).toEqual(new Set(LEVELS));
  });

  it('states the gaps we are not closing', () => {
    expect(CAPABILITY_GAPS.length).toBeGreaterThan(0);
    expect(CAPABILITY_GAPS.join(' ')).toContain('No cloud sync');
  });
});
