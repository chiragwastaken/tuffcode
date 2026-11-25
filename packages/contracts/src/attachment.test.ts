import { describe, expect, it } from 'vitest';
import { AttachmentSchema } from './entities.js';

describe('AttachmentSchema', () => {
  it('accepts a path attachment', () => {
    expect(AttachmentSchema.safeParse({ name: 'notes.md', path: 'C:/work/notes.md' }).success).toBe(
      true,
    );
  });

  it('accepts an inline image attachment', () => {
    expect(
      AttachmentSchema.safeParse({ name: 'shot.png', data: 'AAAA', mimeType: 'image/png' }).success,
    ).toBe(true);
  });

  it('rejects an attachment with neither source', () => {
    expect(AttachmentSchema.safeParse({ name: 'empty' }).success).toBe(false);
  });

  it('rejects an attachment with both sources', () => {
    expect(
      AttachmentSchema.safeParse({ name: 'both', path: 'C:/work/a.png', data: 'AAAA' }).success,
    ).toBe(false);
  });
});
