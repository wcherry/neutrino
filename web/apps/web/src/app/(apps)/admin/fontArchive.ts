/**
 * Finding the fonts in what an administrator dropped on the Fonts tab.
 *
 * A font almost never arrives on its own. A family downloaded from Google
 * Fonts, Font Squirrel or a foundry is a zip holding a dozen weights, often
 * under a directory or two, alongside a licence and a specimen page — and
 * before this the console took one file at a time with a display name typed by
 * hand, so installing Roboto was eighteen uploads and eighteen names (#207).
 *
 * ── Why the zip is opened in the browser ──────────────────────────────────
 *
 * The alternative is posting the archive and having the server expand it, and
 * it buys nothing here. `POST /api/v1/admin/fonts` already validates a font
 * (extension against declared MIME, 50 MB, streamed to a guarded temp file),
 * so a server-side expander would be a *second* upload path — with zip bombs,
 * path traversal and a staging directory to get right — arriving at the same
 * place. And the archive has to be read before anything is uploaded whatever
 * happens: the whole point is to show what is inside and let the admin pick,
 * which server-side would mean an upload, an inspect and a commit with state
 * parked in between.
 *
 * So the zip is read here and each chosen font is uploaded through the
 * endpoint that already exists, exactly as if it had been picked by hand.
 *
 * ── Nothing is inflated until it is uploaded ──────────────────────────────
 *
 * Listing reads only the central directory at the zip's tail, the way
 * `lib/takeout/archive.ts` does and for the same reason: a candidate carries
 * its size and its name off the directory entry, and `read()` inflates that
 * one entry when the upload reaches it. A family of twenty 400 KB weights
 * therefore costs one weight at a time rather than all of them, and an archive
 * where twenty-four of twenty-six fonts are left unticked never inflates the
 * twenty-four. The cost is that the reader stays open for the life of the
 * list, so whoever opened it closes it when the list is replaced.
 */

import {
  BlobReader,
  Uint8ArrayWriter,
  ZipReader,
  configure,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';

/** Font file extensions the server accepts (`drive::fonts::service`). */
export const FONT_EXTENSIONS = ['woff2', 'woff', 'ttf', 'otf'] as const;

export type FontFormat = (typeof FONT_EXTENSIONS)[number];

/**
 * The server's per-file limit (`MAX_FONT_SIZE_BYTES`), mirrored so an
 * over-sized entry is named in the list rather than discovered as a 413 in the
 * middle of an eighteen-font run.
 */
export const MAX_FONT_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * The `Content-Type` to upload each format under.
 *
 * The server checks the declared type against the extension and would accept
 * `application/octet-stream` — which is what a `File` built with no type sends
 * — but a font reconstructed out of a zip should look on the wire exactly like
 * the same font picked off disk.
 */
const CONTENT_TYPES: Record<FontFormat, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** One font that could be installed, found loose or inside an archive. */
export interface FontCandidate {
  /** Stable key for the row and its selection, unique across the whole drop. */
  id: string;
  /** Where it came from: its path inside the zip, or the file's own name. */
  path: string;
  /** The archive it came out of, or `null` when it was dropped on its own. */
  archive: string | null;
  format: FontFormat;
  /** Uncompressed size in bytes. */
  size: number;
  /** The name to install it under, before the admin edits it. */
  suggestedName: string;
  /** Inflate this entry into a `File` ready to upload. */
  read(): Promise<File>;
}

/** Something font-shaped that was found but cannot be installed. */
export interface SkippedEntry {
  path: string;
  reason: string;
}

/** What one drop turned into. */
export interface FontSource {
  candidates: FontCandidate[];
  /**
   * Entries worth mentioning rather than silently dropping — an over-sized
   * font, or a file that is not a font at all. Licences, specimen pages and
   * the rest of an archive's furniture are *not* listed: an admin who drops a
   * family zip does not need to be told it contained a README.
   */
  skipped: SkippedEntry[];
  /** Release the zip readers. Candidates cannot be read after this. */
  close(): Promise<void>;
}

export class FontArchiveError extends Error {}

/**
 * Workers keep inflation off the main thread. They do not exist under jsdom,
 * so the tests run the same code inline.
 */
function configureWorkers(): void {
  configure({ useWebWorkers: typeof Worker !== 'undefined' });
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The font format a path names, or `null` when it does not name one. */
export function fontFormatOf(path: string): FontFormat | null {
  const base = baseNameOf(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return (FONT_EXTENSIONS as readonly string[]).includes(ext) ? (ext as FontFormat) : null;
}

export function isZipFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.zip') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  );
}

/**
 * A display name out of a font's filename.
 *
 * Foundries all name files the same way and none of them name them the way a
 * font picker should read: `Roboto-BoldItalic.ttf`, `OpenSans_Condensed.otf`,
 * `NotoSansJP-Regular.woff2`. So the separators become spaces and the case
 * changes become word boundaries — including the acronym boundary, or
 * `NotoSansJP` comes out as "Noto Sans JP" only by accident.
 *
 * Google's variable fonts carry their axis list in brackets
 * (`Roboto[wdth,wght].ttf`); the axes are a description of the file and not
 * part of anybody's idea of the family's name, so they come off. Whatever is
 * left is a suggestion the admin can overwrite in the row, which is why this
 * leans towards readable rather than towards clever.
 */
export function displayNameForFont(path: string): string {
  const base = baseNameOf(path);
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\[[^\]]*\]/g, ' ');

  const name = stem
    .replace(/[_-]+/g, ' ')
    // `RobotoBold` and `Roboto100Thin` — a lowercase or digit against an
    // uppercase is a word boundary.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // `JPRegular` — the last capital of a run belongs to the word after it.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  // A name made only of separators would leave the row blank and the Install
  // button disabled with nothing to explain it.
  return name || base;
}

/** zip.js only offers `getData` on file entries; directories have no content. */
function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * Housekeeping macOS adds when it builds a zip: the `__MACOSX/` shadow tree,
 * `.DS_Store`, and the `._Roboto.ttf` resource forks that sit beside the real
 * files and carry their names and extensions. Left in, every font in a
 * Finder-made archive would be listed twice, once as a few hundred bytes of
 * metadata that is not a font.
 */
function isMacOsMetadata(path: string): boolean {
  if (path.startsWith('__MACOSX/')) return true;
  const base = baseNameOf(path);
  return base === '.DS_Store' || base.startsWith('._');
}

function candidatesFromZip(
  file: File,
  entries: FileEntry[],
  seed: number,
): { candidates: FontCandidate[]; skipped: SkippedEntry[] } {
  const candidates: FontCandidate[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of entries) {
    const path = entry.filename;
    if (isMacOsMetadata(path)) continue;

    const format = fontFormatOf(path);
    // Licences, specimen pages, the rest of a family archive's furniture.
    if (!format) continue;

    const size = entry.uncompressedSize ?? 0;
    if (size > MAX_FONT_SIZE_BYTES) {
      skipped.push({ path, reason: 'larger than the 50 MB limit' });
      continue;
    }
    if (size === 0) {
      skipped.push({ path, reason: 'empty' });
      continue;
    }

    candidates.push({
      id: `${seed}:${path}`,
      path,
      archive: file.name,
      format,
      size,
      suggestedName: displayNameForFont(path),
      // Inflated into bytes rather than into a `Blob`, because the `File` that
      // goes into the `FormData` has to carry the entry's own name and the
      // font's content type — and `new File([blob], …)` is a re-wrap that
      // jsdom does not perform faithfully, which would make this untestable.
      // The multipart body holds the whole font anyway, so nothing is spent.
      async read() {
        const bytes = await entry.getData(new Uint8ArrayWriter());
        return new File([bytes], baseNameOf(path), { type: CONTENT_TYPES[format] });
      },
    });
  }

  return { candidates, skipped };
}

function candidateFromFile(file: File, seed: number): FontCandidate | SkippedEntry {
  const format = fontFormatOf(file.name);
  if (!format) return { path: file.name, reason: 'not a font or a zip archive' };
  if (file.size > MAX_FONT_SIZE_BYTES) {
    return { path: file.name, reason: 'larger than the 50 MB limit' };
  }
  return {
    id: `${seed}:${file.name}`,
    path: file.name,
    archive: null,
    format,
    size: file.size,
    suggestedName: displayNameForFont(file.name),
    read: async () => file,
  };
}

function isSkipped(value: FontCandidate | SkippedEntry): value is SkippedEntry {
  return 'reason' in value;
}

/**
 * Everything installable in a drop, whether that was one font, several, a zip,
 * or a mixture.
 *
 * One entry point for all of them because they are the same operation from the
 * admin's side and should reach the same list: a single `.ttf` is a family
 * archive of one, and having it skip the review step would mean two upload
 * paths that could disagree about naming.
 *
 * Only an unreadable zip throws. Anything else that cannot be installed is
 * reported through `skipped`, because a drop is usually somebody's whole
 * download and refusing all of it over one bad file helps nobody.
 */
export async function readFontSources(files: File[]): Promise<FontSource> {
  if (files.length === 0) throw new FontArchiveError('No files were chosen.');
  configureWorkers();

  const readers: ZipReader<unknown>[] = [];
  const candidates: FontCandidate[] = [];
  const skipped: SkippedEntry[] = [];

  const closeAll = async () => {
    await Promise.all(readers.map((r) => r.close().catch(() => {})));
  };

  try {
    for (const [index, file] of files.entries()) {
      if (!isZipFile(file)) {
        const result = candidateFromFile(file, index);
        if (isSkipped(result)) skipped.push(result);
        else candidates.push(result);
        continue;
      }

      // In sequence rather than concurrently: each reader brings its own
      // worker pool, and reading a central directory is a tail seek.
      const reader = new ZipReader(new BlobReader(file));
      readers.push(reader);
      let entries: Entry[];
      try {
        entries = await reader.getEntries();
      } catch {
        throw new FontArchiveError(`${file.name} is not a readable zip archive.`);
      }

      const found = candidatesFromZip(file, entries.filter(isFileEntry), index);
      candidates.push(...found.candidates);
      skipped.push(...found.skipped);
    }
  } catch (err) {
    await closeAll();
    throw err;
  }

  // Alphabetical by the name they will be installed under, which is the order
  // the list is read in — a family's weights arrive together whether or not
  // the archive stored them that way.
  candidates.sort((a, b) => a.suggestedName.localeCompare(b.suggestedName));

  return { candidates, skipped, close: closeAll };
}
