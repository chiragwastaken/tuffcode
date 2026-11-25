import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TurnAttachment } from '@tuffcode/contracts';
import {
  MAX_IMAGE_BYTES,
  attachmentMimeType,
  base64DecodedBytes,
  imageLabels,
  planAttachments,
} from './attachments.js';

/** A 1x1 PNG, small enough to inline and real enough to base64. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

function image(overrides: Partial<TurnAttachment> = {}): TurnAttachment {
  return { kind: 'image', mimeType: 'image/png', data: TINY_PNG, ...overrides };
}

describe('attachmentMimeType', () => {
  it('prefers a declared image type and falls back to the extension', () => {
    expect(attachmentMimeType(image())).toBe('image/png');
    expect(attachmentMimeType({ kind: 'image', path: 'C:/work/shot.JPEG' })).toBe('image/jpeg');
    expect(attachmentMimeType({ kind: 'image', path: 'C:/work/notes.txt' })).toBeNull();
    expect(attachmentMimeType({ kind: 'image', path: 'C:/work/noext' })).toBeNull();
  });

  it('ignores a non-image declared type and still reads the extension', () => {
    expect(
      attachmentMimeType({ kind: 'image', path: 'C:/work/shot.webp', mimeType: 'text/plain' }),
    ).toBe('image/webp');
  });
});

describe('base64DecodedBytes', () => {
  it('measures canonical base64 and rejects anything else', () => {
    expect(base64DecodedBytes('AAAA')).toBe(3);
    expect(base64DecodedBytes('AAA=')).toBe(2);
    expect(base64DecodedBytes('AA==')).toBe(1);
    expect(base64DecodedBytes('')).toBeNull();
    expect(base64DecodedBytes('AAA')).toBeNull();
    expect(base64DecodedBytes('AA$A')).toBeNull();
  });
});

describe('planAttachments', () => {
  it('inlines an image when the model can see images', async () => {
    const plan = await planAttachments([image({ name: 'shot.png' })], true);
    expect(plan.images).toEqual([{ name: 'shot.png', mimeType: 'image/png', data: TINY_PNG }]);
    expect(plan.notes).toEqual([]);
    expect(imageLabels(plan.images)).toEqual(['Image file: shot.png']);
  });

  it('falls back to a readable label when the attachment has no name', async () => {
    const plan = await planAttachments([image()], true);
    expect(plan.images[0]?.name).toBe('attached image');
  });

  it('names the image instead of inlining it when the model has no vision', async () => {
    const plan = await planAttachments([image({ path: 'C:/work/shot.png' })], false);
    expect(plan.images).toEqual([]);
    expect(plan.notes).toEqual(['[Image attached: shot.png - this model cannot view images]']);
  });

  it('keeps a text attachment as a file line', async () => {
    const plan = await planAttachments([{ kind: 'file', path: 'C:/work/notes.md' }], true);
    expect(plan.images).toEqual([]);
    expect(plan.notes).toEqual(['- C:/work/notes.md (file)']);
  });

  it('refuses a format the providers do not accept', async () => {
    const plan = await planAttachments([image({ mimeType: 'image/bmp' })], true);
    expect(plan.images).toEqual([]);
    expect(plan.notes[0]).toContain('unsupported image format');
  });

  it('refuses bytes that are not base64', async () => {
    const plan = await planAttachments([image({ data: 'not base64!' })], true);
    expect(plan.images).toEqual([]);
    expect(plan.notes[0]).toContain('not valid base64');
  });

  it('reads a path-backed image from disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tuffcode-attach-'));
    const file = join(root, 'shot.png');
    writeFileSync(file, Buffer.from(TINY_PNG, 'base64'));
    const plan = await planAttachments([{ kind: 'image', path: file, mimeType: 'image/png' }], true);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0]?.name).toBe('shot.png');
    expect(plan.images[0]?.data).toBe(TINY_PNG);
  });

  it('reports an unreadable path instead of throwing', async () => {
    const plan = await planAttachments(
      [{ kind: 'image', path: join(tmpdir(), 'tuffcode-does-not-exist.png'), mimeType: 'image/png' }],
      true,
    );
    expect(plan.images).toEqual([]);
    expect(plan.notes[0]).toContain('could not be read');
  });

  it('drops an image over the per-image ceiling and says why', async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 4).toString('base64');
    const plan = await planAttachments([image({ data: oversized })], true);
    expect(plan.images).toEqual([]);
    expect(plan.notes[0]).toContain('5 MB limit');
  });

  it('spends the turn budget across images and keeps what fits', async () => {
    const half = Buffer.alloc(4 * 1024 * 1024).toString('base64');
    const plan = await planAttachments([image({ data: half }), image({ data: half }), image()], true);
    expect(plan.images).toHaveLength(2);
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0]).toContain('8 MB image budget');
  });
});
