import { describe, expect, it } from 'vitest';
import {
  base64Bytes,
  filesFromTransfer,
  imageTypeOf,
  isImageFile,
  pastedImageName,
  scaledSize,
  stripDataUrl,
  SUPPORTED_IMAGE_TYPES,
} from './attachments';

/** A File stand-in: jsdom's File is enough, and the helpers never read the bytes. */
function fileOf(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('imageTypeOf', () => {
  it('reads a declared image type', () => {
    expect(imageTypeOf(fileOf('shot.png', 'image/png'))).toBe('image/png');
  });

  it('ignores the charset suffix some clipboards add', () => {
    expect(imageTypeOf(fileOf('shot.png', 'image/png;charset=binary'))).toBe('image/png');
  });

  it('falls back to the extension when the type is blank', () => {
    expect(imageTypeOf(fileOf('shot.JPEG', ''))).toBe('image/jpeg');
    expect(imageTypeOf(fileOf('shot.webp', 'application/octet-stream'))).toBe('image/webp');
  });

  it('refuses a format the providers do not accept', () => {
    expect(imageTypeOf(fileOf('shot.bmp', 'image/bmp'))).toBeNull();
    expect(imageTypeOf(fileOf('notes.txt', 'text/plain'))).toBeNull();
  });

  it('isImageFile agrees with imageTypeOf', () => {
    expect(isImageFile(fileOf('a.png', 'image/png'))).toBe(true);
    expect(isImageFile(fileOf('a.pdf', 'application/pdf'))).toBe(false);
    expect(SUPPORTED_IMAGE_TYPES).toContain('image/webp');
  });
});

describe('pastedImageName', () => {
  it('builds a timestamped name with the right extension', () => {
    expect(pastedImageName('image/png')).toMatch(/^pasted-image-[\dT-]+\.png$/);
    expect(pastedImageName('image/jpeg', 1)).toMatch(/^pasted-image-[\dT-]+-2\.jpg$/);
  });

  it('falls back to png for an unknown type', () => {
    expect(pastedImageName('image/avif')).toMatch(/\.png$/);
  });
});

describe('scaledSize', () => {
  it('leaves an image under the ceiling alone', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales the longest edge down and keeps the ratio', () => {
    expect(scaledSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(scaledSize(1000, 4000)).toEqual({ width: 512, height: 2048 });
  });

  it('never returns a zero dimension', () => {
    expect(scaledSize(10000, 1)).toEqual({ width: 2048, height: 1 });
  });
});

describe('base64Bytes and stripDataUrl', () => {
  it('measures decoded bytes', () => {
    expect(base64Bytes('AAAA')).toBe(3);
    expect(base64Bytes('AA==')).toBe(1);
  });

  it('strips the data URL prefix', () => {
    expect(stripDataUrl('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(stripDataUrl('AAAA')).toBe('AAAA');
  });
});

describe('filesFromTransfer', () => {
  it('returns nothing for a missing transfer', () => {
    expect(filesFromTransfer(null)).toEqual([]);
  });
});
