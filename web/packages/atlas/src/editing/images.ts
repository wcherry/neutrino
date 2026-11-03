import type { WikiLinkReference } from '../tree';
import type { PageSyntax, SyntaxBlock } from '../syntax/pageSyntax';
import { lineContent, type TextEdit } from './markdownEditing';

/**
 * Where an image in a page comes from. The app turns it into something to show: it resolves the
 * file in the vault and reads it from the encrypted copy, so nothing is written out to show it.
 * AtlasKit's `ImageSource`.
 */
export type ImageSource =
  /** `![[photo.png]]`, resolved like a wiki link (SPEC §4.3). */
  | { type: 'embed'; ref: WikiLinkReference }
  /** `![alt](photo.png)`: a path in the vault, as written, percent-decoded. */
  | { type: 'path'; path: string }
  /** `![Q4 plan](https://…/open/doc/<id>)`: a preview of a file the app links to, for a URL the app vouches for. */
  | { type: 'url'; url: string };

/** A stable key for an image source, for caches. */
export function imageSourceKey(source: ImageSource): string {
  switch (source.type) {
    case 'embed': return `embed:${source.ref.target}`;
    case 'path': return `path:${source.path}`;
    case 'url': return `url:${source.url}`;
  }
}

/** An image that a block of its own shows in Live Preview, in place of its Markdown while the cursor is elsewhere. */
export interface BlockImage {
  source: ImageSource;
  /** The width asked for with an embed's display hint, `![[photo.png|300]]` or `|300x200`. */
  width: number | null;
}

/** File types shown as images. Others (`.pdf`, `.mp3`) stay links. */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp']);

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function percentDecoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The image `block` shows: a paragraph holding one image or image embed and nothing else but
 * spaces. An image inside a sentence stays a link. Web images aren't shown: fetching one would
 * tell its server which page is being read, so they stay links too. `allowingURL` names the
 * web URLs that may show anyway: the app's own links to files on its server.
 */
export function blockImage(block: SyntaxBlock, text: string, allowingURL: (url: string) => boolean = () => false): BlockImage | null {
  if (block.node.type !== 'paragraph') return null;
  const constructs = block.spans.filter((s) => s.kind.type !== 'syntax');
  if (constructs.length !== 1) return null;
  const span = constructs[0];
  if (block.to > text.length) return null;
  if (!/^\s*$/u.test(text.slice(block.from, span.from) + text.slice(span.to, block.to))) return null;

  const kind = span.kind;
  if (kind.type === 'embed') {
    if (!IMAGE_EXTENSIONS.has(extension(kind.ref.target))) return null;
    const hint = kind.ref.alias?.split('x', 2)[0];
    const width = hint !== undefined && /^\d+$/.test(hint) && Number(hint) > 0 ? Number(hint) : null;
    return { source: { type: 'embed', ref: kind.ref }, width };
  }
  if (kind.type === 'image') {
    if (allowingURL(kind.url)) return { source: { type: 'url', url: kind.url }, width: null };
    const path = percentDecoded(kind.url);
    // A scheme (`https:`, `data:`) or a host (`//cdn…`) means it isn't in the vault.
    if (path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(kind.url) || !IMAGE_EXTENSIONS.has(extension(path))) return null;
    return { source: { type: 'path', path }, width: null };
  }
  return null;
}

/** The file extension an image's bytes call for, from their signature: null for anything that isn't an image Atlas shows. */
export function imageFileExtension(data: Uint8Array): string | null {
  const starts = (p: number[], at = 0) => data.length >= at + p.length && p.every((b, k) => data[at + k] === b);
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(ascii('GIF8'))) return 'gif';
  if (starts(ascii('RIFF')) && starts(ascii('WEBP'), 8)) return 'webp';
  if (starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (starts(ascii('BM'))) return 'bmp';
  if (starts(ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...data.slice(8, 12));
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'heic';
  }
  return null;
}

/** The MIME type for an image extension, for showing it. */
export function imageMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'tif': case 'tiff': return 'image/tiff';
    case 'heic': case 'heif': return 'image/heic';
    default: return `image/${ext.toLowerCase()}`;
  }
}

const isBlank = (s: string) => /^[ \t]*$/.test(s);

/**
 * `blocks` in place of the selection, each a paragraph of its own, with blank lines around. The
 * cursor goes after the last.
 */
export function insertBlocks(blocks: readonly string[], text: string, selection: { from: number; to: number }): TextEdit | null {
  if (blocks.length === 0) return null;
  const first = lineContent(text, selection.from);
  const last = lineContent(text, selection.to);
  const head = text.slice(first.from, selection.from);
  const tail = text.slice(selection.to, last.to);
  let before = '';
  let after = '';
  if (!isBlank(head)) {
    before = '\n\n';
  } else if (first.from > 0) {
    const previous = lineContent(text, first.from - 1);
    if (!isBlank(text.slice(previous.from, previous.to))) before = '\n';
  }
  if (!isBlank(tail)) {
    after = '\n\n';
  } else if (last.to < text.length) {
    const next = lineContent(text, last.to + 1);
    if (!isBlank(text.slice(next.from, next.to))) after = '\n';
  }
  // On an otherwise empty line the blocks replace the line's spaces too.
  const from = isBlank(head) ? first.from : selection.from;
  const to = isBlank(head) ? (isBlank(tail) ? last.to : selection.to) : selection.to;
  const body = blocks.join('\n\n');
  const cursor = from + (before + body).length;
  return { from, to, insert: before + body + after, selection: { from: cursor, to: cursor } };
}

/** Embeds `targets` (`![[target]]`) in place of the selection, each a block of its own, so Live Preview shows them as images. */
export function insertEmbeds(targets: readonly string[], text: string, selection: { from: number; to: number }): TextEdit | null {
  return insertBlocks(targets.map((t) => `![[${t}]]`), text, selection);
}

/** The link or image at `offset` whose URL `isFileLink` accepts, and whether it shows as a preview (`![…](…)`) rather than a chip. */
export function fileLinkAt(offset: number, syntax: PageSyntax, isFileLink: (url: string) => boolean): { from: number; to: number; isPreview: boolean } | null {
  for (const block of syntax.blocks) {
    if (!(block.from <= offset && offset <= block.to)) continue;
    for (const span of block.spans) {
      if (!(span.from <= offset && offset < span.to)) continue;
      if (span.kind.type === 'link' && isFileLink(span.kind.url)) return { from: span.from, to: span.to, isPreview: false };
      if (span.kind.type === 'image' && isFileLink(span.kind.url)) return { from: span.from, to: span.to, isPreview: true };
    }
  }
  return null;
}

/**
 * Show as Preview / Show as Chip for the file link at `offset`. A preview is `![…](…)` on a line
 * of its own, so a link inside a sentence moves to its own line below; a chip is the link with
 * its `!` taken off, where it stands.
 */
export function setPreview(preview: boolean, offset: number, text: string, syntax: PageSyntax, isFileLink: (url: string) => boolean): TextEdit | null {
  const found = fileLinkAt(offset, syntax, isFileLink);
  if (!found || found.isPreview === preview) return null;
  if (!preview) return { from: found.from, to: found.from + 1, insert: '', selection: { from: found.to - 1, to: found.to - 1 } };
  const link = text.slice(found.from, found.to);
  const line = lineContent(text, found.from);
  const rest = text.slice(line.from, found.from) + text.slice(found.to, line.to);
  if (isBlank(rest)) return { from: found.from, to: found.from, insert: '!', selection: { from: found.to + 1, to: found.to + 1 } };
  // In a sentence: the link leaves it (spaces closed up) and goes below as a block.
  let before = text.slice(line.from, found.from);
  let after = text.slice(found.to, line.to);
  if (before.endsWith(' ') && (after.startsWith(' ') || after === '' || ',.;:!?)'.includes(after[0]))) before = before.slice(0, -1);
  if (before === '' && after.startsWith(' ')) after = after.slice(1);
  const kept = before + after;
  let trailing = '';
  if (line.to < text.length) {
    const next = lineContent(text, line.to + 1);
    if (!isBlank(text.slice(next.from, next.to))) trailing = '\n';
  }
  const cursor = line.from + (kept + '\n\n!' + link).length;
  return { from: line.from, to: line.to, insert: kept + '\n\n!' + link + trailing, selection: { from: cursor, to: cursor } };
}
