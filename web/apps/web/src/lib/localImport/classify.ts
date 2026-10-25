/**
 * What kind of file a picked file is, for the local folder import.
 *
 * The kind decides which destinations a file is offered (`destinations.ts`):
 * media goes to Photos (and so to Drive), office files to Drive where Docs,
 * Sheets and Slides open them byte for byte, Markdown to Notes, and everything
 * else to Drive as it is. Two edges matter and are easy to get wrong:
 *
 * - **SVG is not media.** It is an `image/*` type, but the Photos library
 *   cannot draw it as a photo and Drive opens it in Diagrams.
 * - **Legacy `.doc/.xls/.ppt` are not office.** No editor opens them (see
 *   `officeFormats.ts`), so offering "opens in Docs" would be a promise the app
 *   does not keep.
 */

import { OOXML_MIME, OOXML_TEMPLATE_MIME } from '@neutrino/api-core';
import { officeAppForFile } from '@/lib/officeFormats';

export type ImportKind = 'media' | 'office' | 'markdown' | 'other';

/** Every kind, in the order the summary shows them. */
export const IMPORT_KINDS: readonly ImportKind[] = ['media', 'office', 'markdown', 'other'];

const MARKDOWN_MIME = 'text/markdown';
const GENERIC_MIME = 'application/octet-stream';

/** Media extensions and the mime type each uploads with when the browser gave none. */
const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  dng: 'image/x-adobe-dng',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

/** Everything else worth naming when the browser reported nothing. */
const OTHER_MIME_BY_EXTENSION: Record<string, string> = {
  docx: OOXML_MIME.docx,
  xlsx: OOXML_MIME.xlsx,
  pptx: OOXML_MIME.pptx,
  dotx: OOXML_TEMPLATE_MIME.dotx,
  md: MARKDOWN_MIME,
  markdown: MARKDOWN_MIME,
  txt: 'text/plain',
  csv: 'text/csv',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  json: 'application/json',
};

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

function isGeneric(mimeType: string): boolean {
  return mimeType === '' || mimeType === GENERIC_MIME;
}

export function classifyFile(name: string, mimeType: string): ImportKind {
  const ext = extensionOf(name);
  const mime = mimeType.toLowerCase();

  if (ext === 'svg' || mime === 'image/svg+xml') return 'other';
  if (mime.startsWith('image/') || mime.startsWith('video/') || ext in MEDIA_MIME_BY_EXTENSION) return 'media';
  if (officeAppForFile(mime, name) !== null) return 'office';
  if (mime === MARKDOWN_MIME || MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  return 'other';
}

/**
 * The mime type to upload with: the browser's, or one inferred from the
 * extension when the browser reported '' or application/octet-stream.
 *
 * Drive decides which app opens a file from its mime type, so a `.docx` the
 * browser could not type would otherwise arrive as an opaque blob.
 */
export function mimeTypeFor(name: string, browserType: string): string {
  if (!isGeneric(browserType)) return browserType;
  const ext = extensionOf(name);
  return MEDIA_MIME_BY_EXTENSION[ext] ?? OTHER_MIME_BY_EXTENSION[ext] ?? GENERIC_MIME;
}

const IGNORED_NAMES = new Set(['thumbs.db', 'desktop.ini']);

/** OS clutter never imported: any path segment starting with '.', Thumbs.db, desktop.ini. */
export function isIgnoredPath(path: string): boolean {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s.startsWith('.'))) return true;
  const base = segments[segments.length - 1] ?? '';
  return IGNORED_NAMES.has(base.toLowerCase());
}
