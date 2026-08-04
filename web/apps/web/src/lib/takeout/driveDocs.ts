/**
 * Finding Google Docs documents inside a Takeout archive.
 *
 * Docs are not a product directory of their own: a Google Doc is a Drive file,
 * so it comes out under `Takeout/Drive/`, converted on the way out to whatever
 * format the export was configured for, in the folder tree the user had:
 *
 *     Takeout/
 *       Drive/
 *         Meeting notes.docx
 *         Meeting notes.docx-info.json
 *         Work/
 *           Q3 plan.docx
 *           budget.xlsx
 *           logo.png
 *
 * Only the document-shaped files are of interest here, and only those the
 * browser can convert: `.docx` (the Takeout default), `.html` and `.txt`.
 * Spreadsheets, presentations, images and everything else in the export are
 * not documents and are ignored outright. Documents in a format we cannot
 * convert (`.pdf`, `.odt`, `.rtf`, `.epub`) are a different case — the user
 * chose that format for their Docs and would otherwise be told, wrongly, that
 * the archive contains no documents — so those are counted and reported.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import { describeError, logStep, logWarn } from './log';

/** Directory names Google uses for Drive. */
const DRIVE_DIR_NAMES = ['drive', 'google drive', 'my drive'];

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
export interface DriveDocInfo {
  title?: string;
  description?: string;
}

// ── Locating the documents ────────────────────────────────────────────────────

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function folderPath(path: string): string[] {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? [] : path.slice(0, slash).split('/');
}

/**
 * Google writes one `<file>-info.json` per exported file when the user asks
 * for metadata. Which name it hangs off — the full filename or the filename
 * without its extension — has varied between exports, so both are accepted.
 */
function sidecarFor(path: string, byPath: Map<string, TakeoutEntry>): TakeoutEntry | undefined {
  return byPath.get(`${path}-info.json`.toLowerCase()) ?? byPath.get(`${stripExtension(path)}-info.json`.toLowerCase());
}

function collect(dir: TakeoutProductDir): DriveDocsSource {
  const jsonByPath = new Map<string, TakeoutEntry>();
  for (const entry of dir.entries) {
    if (entry.ext === 'json') jsonByPath.set(entry.path.toLowerCase(), entry);
  }

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

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/**
 * The product directory holding the most `.docx` files.
 *
 * Google localises the Drive directory's name, so a non-English export has to
 * be recognised by its contents. A `.docx` is the strong signal — no other
 * Takeout product emits one — whereas `.html` and `.txt` are not: Keep writes
 * an `.html` beside every note, and sniffing for those would hand Keep's notes
 * to the docs importer.
 */
function directoryWithDocx(archive: TakeoutArchive): TakeoutProductDir | null {
  let best: TakeoutProductDir | null = null;
  let bestCount = 0;
  for (const product of archive.products) {
    const count = product.entries.filter((e) => e.ext === 'docx').length;
    if (count > bestCount) {
      best = product;
      bestCount = count;
    }
  }
  return best;
}

/** Locate the documents in an archive, or `null` when it holds none. */
export function findDriveDocs(archive: TakeoutArchive): DriveDocsSource | null {
  const named = archive.products.find((p) => DRIVE_DIR_NAMES.includes(p.name.toLowerCase()));
  const dir = named ?? directoryWithDocx(archive);
  if (!dir) {
    logWarn('docs', 'no Drive directory found', {
      products: archive.products.map((p) => p.name),
      looksFor: DRIVE_DIR_NAMES,
      orAnyDirectoryHolding: '.docx',
    });
    return null;
  }
  logStep('docs', `using ${dir.name}`, { matchedBy: named ? 'name' : 'the .docx files in it' });

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

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Read a document's `-info.json`, or `null` when there isn't one or it makes
 * no sense.
 *
 * The sidecar matters because a filename is a lossy record of a title: Takeout
 * replaces characters it cannot put in a filename and appends `(1)` to
 * disambiguate, while `title` is what the document was actually called. The
 * exact field names have shifted between Takeout versions, so this reads
 * leniently and every field is optional — a sidecar it cannot make sense of
 * simply leaves the filename in charge.
 */
export async function readDocInfo(entry: TakeoutEntry | undefined): Promise<DriveDocInfo | null> {
  if (!entry) return null;
  try {
    const parsed: unknown = JSON.parse(await entry.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return {
      title: stringField(record, 'title', 'name'),
      description: stringField(record, 'description'),
    };
  } catch (err) {
    // Not fatal — the filename is a perfectly good title — but worth a line,
    // since a sidecar format we no longer recognise would show up as every
    // document silently keeping its filename.
    logWarn('docs', `could not read ${entry.path}`, describeError(err));
    return null;
  }
}
