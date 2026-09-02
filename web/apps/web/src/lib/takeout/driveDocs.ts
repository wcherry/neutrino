/**
 * Finding Google Docs documents inside a Takeout archive.
 *
 * Docs are not a product directory of their own: a Google Doc is a Drive file,
 * so it comes out under `Takeout/Drive/` in the folder tree the user had —
 * `drive.ts` describes that layout and locates the directory.
 *
 * Only the document-shaped files are of interest here, and only those the
 * browser can convert: `.docx` (the Takeout default), `.html` and `.txt`.
 * Spreadsheets, presentations, images and everything else in the export are
 * not documents and are ignored outright — spreadsheets and presentations have
 * finders of their own (`driveSheets.ts`, `driveSlides.ts`). Documents in a format we cannot convert (`.pdf`,
 * `.odt`, `.rtf`, `.epub`) are a different case — the user chose that format
 * for their Docs and would otherwise be told, wrongly, that the archive
 * contains no documents — so those are counted and reported.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import {
  baseName,
  countBy,
  findDriveDirectory,
  folderPath,
  jsonEntriesByPath,
  readDriveInfo,
  sidecarFor,
  stripExtension,
  type DriveFileInfo,
} from './drive';
import { logStep, logWarn } from './log';

/** How a document's bytes have to be read to get at its content. */
export type DocFormat = 'docx' | 'html' | 'text';

const FORMAT_BY_EXTENSION: Record<string, DocFormat> = {
  docx: 'docx',
  html: 'html',
  htm: 'html',
  txt: 'text',
};

/**
 * Document formats Takeout can produce that cannot be converted here, mapped
 * to what to call them when reporting.
 */
const UNCONVERTIBLE_BY_EXTENSION: Record<string, string> = {
  pdf: 'PDF',
  odt: 'OpenDocument text',
  rtf: 'Rich Text',
  epub: 'EPUB',
  doc: 'Word 97–2003',
};

export interface DriveDocEntry {
  entry: TakeoutEntry;
  format: DocFormat;
  /** Title taken from the filename; `readDocInfo` may have a better one. */
  title: string;
  /** The folders this file sat in inside the export, outermost first. */
  path: string[];
  /** Google's metadata sidecar for this file, when the export includes them. */
  info?: TakeoutEntry;
}

export interface UnsupportedDoc {
  /** Path inside the Drive directory. */
  path: string;
  /** Human-readable format name, e.g. `PDF`. */
  format: string;
}

export interface DriveDocsSource {
  /** Directory the documents came from, for display. */
  directory: string;
  docs: DriveDocEntry[];
  unsupported: UnsupportedDoc[];
}

/** What we read back out of a `-info.json` sidecar. */
export type DriveDocInfo = DriveFileInfo;

// ── Locating the documents ────────────────────────────────────────────────────

function collect(dir: TakeoutProductDir): DriveDocsSource {
  const jsonByPath = jsonEntriesByPath(dir);

  const docs: DriveDocEntry[] = [];
  const unsupported: UnsupportedDoc[] = [];
  /** Extensions that were neither a document nor a format we report on. */
  const ignored = new Map<string, number>();

  for (const entry of dir.entries) {
    const format = FORMAT_BY_EXTENSION[entry.ext];
    if (format) {
      docs.push({
        entry,
        format,
        title: stripExtension(baseName(entry.path)),
        path: folderPath(entry.path),
        info: sidecarFor(entry.path, jsonByPath),
      });
      continue;
    }
    const unconvertible = UNCONVERTIBLE_BY_EXTENSION[entry.ext];
    if (unconvertible) unsupported.push({ path: entry.path, format: unconvertible });
    else ignored.set(entry.ext || '(no extension)', (ignored.get(entry.ext || '(no extension)') ?? 0) + 1);
  }

  // The ignored tally is the answer to "why didn't it find my documents?" —
  // it names the extensions that were passed over, which is what an export
  // made in the wrong format looks like from here.
  logStep('docs', `scanned ${dir.name}`, {
    entries: dir.entries.length,
    documents: docs.length,
    byFormat: countBy(docs.map((d) => d.format)),
    withSidecar: docs.filter((d) => d.info).length,
    unsupported: countBy(unsupported.map((u) => u.format)),
    ignored: Object.fromEntries(ignored),
  });

  return { directory: dir.name, docs, unsupported };
}

/** Locate the documents in an archive, or `null` when it holds none. */
export function findDriveDocs(archive: TakeoutArchive): DriveDocsSource | null {
  // `.docx` is the signal for a Drive directory Google localised the name of —
  // see `drive.ts` for why it can't be `.html` or `.txt`.
  const dir = findDriveDirectory(archive, { scope: 'docs', signalExt: 'docx' });
  if (!dir) return null;

  const source = collect(dir);
  // A Drive directory of nothing but photos and spreadsheets is not a docs
  // export, and saying so is the page's "no documents found" case.
  if (source.docs.length === 0 && source.unsupported.length === 0) {
    logWarn('docs', `${dir.name} holds no documents in any format`);
    return null;
  }
  return source;
}

// ── The metadata sidecar ──────────────────────────────────────────────────────

/** Read a document's `-info.json`. See `readDriveInfo` for what it is good for. */
export function readDocInfo(entry: TakeoutEntry | undefined): Promise<DriveDocInfo | null> {
  return readDriveInfo(entry, 'docs');
}
