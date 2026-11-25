import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { TurnAttachment } from '@tuffcode/contracts';

/** Decoded bytes one image may carry; the same ceiling Cline uses for prompt media. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Decoded bytes all images in one turn may carry together. */
export const MAX_TURN_IMAGE_BYTES = 8 * 1024 * 1024;

/** Formats every vendor accepts; anything else is named in the transcript, not inlined. */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/** An image ready to be inlined as base64, with no `data:` prefix on `data`. */
export interface InlineImage {
  name: string;
  mimeType: string;
  data: string;
}

/** What an adapter should put in the user message for one turn. */
export interface AttachmentPlan {
  /** Images to inline, already inside the size budget. */
  images: InlineImage[];
  /** Lines describing attachments that travel as text: file mentions and omitted images. */
  notes: string[];
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The MIME type for one attachment, falling back to the file extension. */
export function attachmentMimeType(attachment: TurnAttachment): string | null {
  const declared = attachment.mimeType?.trim().toLowerCase();
  if (declared !== undefined && declared.startsWith('image/')) return declared;
  const name = attachmentName(attachment);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** The name an attachment carries: the wire name, else the basename of its path. */
export function attachmentName(attachment: TurnAttachment): string {
  if (attachment.name !== undefined && attachment.name.trim().length > 0) return attachment.name;
  return attachment.path === undefined ? 'attached image' : basename(attachment.path);
}

/** Decoded byte length of a base64 payload, or `null` when it is not canonical base64. */
export function base64DecodedBytes(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const body = value.slice(0, value.length - padding);
  if (!/^[A-Za-z0-9+/]+$/.test(body)) return null;
  return (value.length / 4) * 3 - padding;
}

/**
 * Reads one image into base64. Inline bytes win; a path is read from disk. Returns a
 * reason instead of throwing, because a missing file must not fail the whole turn.
 */
async function readImage(
  attachment: TurnAttachment,
): Promise<{ image: InlineImage; bytes: number } | { reason: string }> {
  const mimeType = attachmentMimeType(attachment);
  if (mimeType === null) return { reason: 'unsupported image format' };
  if (!(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { reason: `unsupported image format ${mimeType}` };
  }
  if (attachment.data !== undefined) {
    const bytes = base64DecodedBytes(attachment.data);
    if (bytes === null) return { reason: 'image data is not valid base64' };
    return {
      image: { name: attachmentName(attachment), mimeType, data: attachment.data },
      bytes,
    };
  }
  if (attachment.path === undefined) return { reason: 'image has no source' };
  const name = attachmentName(attachment);
  let buffer: Buffer;
  try {
    buffer = await readFile(attachment.path);
  } catch {
    return { reason: 'image file could not be read' };
  }
  return {
    image: { name, mimeType, data: buffer.toString('base64') },
    bytes: buffer.length,
  };
}

/**
 * Splits a turn's attachments into inline images and text notes. An image is inlined
 * only when the model can see images and the turn stays inside the byte budget;
 * otherwise it becomes a note that names the file and the reason, so the model and the
 * user both know an image existed instead of silently losing it.
 */
export async function planAttachments(
  attachments: readonly TurnAttachment[],
  vision: boolean,
): Promise<AttachmentPlan> {
  const images: InlineImage[] = [];
  const notes: string[] = [];
  let spent = 0;

  for (const attachment of attachments) {
    const label = attachmentName(attachment);
    if (attachment.kind !== 'image') {
      notes.push(`- ${attachment.path ?? label} (file)`);
      continue;
    }
    if (!vision) {
      notes.push(`[Image attached: ${label} - this model cannot view images]`);
      continue;
    }
    const read = await readImage(attachment);
    if ('reason' in read) {
      notes.push(`[Image attached: ${label} - ${read.reason}]`);
      continue;
    }
    if (read.bytes > MAX_IMAGE_BYTES) {
      notes.push(`[Image attached: ${label} - larger than the 5 MB limit]`);
      continue;
    }
    if (spent + read.bytes > MAX_TURN_IMAGE_BYTES) {
      notes.push(`[Image attached: ${label} - this turn is over the 8 MB image budget]`);
      continue;
    }
    spent += read.bytes;
    images.push({ ...read.image, name: label });
  }

  return { images, notes };
}

/** The user text plus one labelled line per image, matching how Aider names images. */
export function imageLabels(images: readonly InlineImage[]): string[] {
  return images.map((image) => `Image file: ${image.name}`);
}
