import { describe, expect, it } from 'vitest';
import { newId } from '@tuffcode/shared';

describe('newId', () => {
  it('returns prefix plus 16 hex characters', () => {
    expect(newId('thr')).toMatch(/^thr_[0-9a-f]{16}$/);
  });

  it('is unique across 1000 calls', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      ids.add(newId('evt'));
    }
    expect(ids.size).toBe(1000);
  });
});
