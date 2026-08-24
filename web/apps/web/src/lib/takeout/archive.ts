/**
 * Reading a Google Takeout archive.
 *
 * A Takeout export is a zip whose entries all sit under a single wrapper
 * directory — `Takeout/` in English, localised in other languages — with one
 * subdirectory per exported product:
 *
 *     Takeout/
 *       archive_browser.html
 *       Keep/
 *         Some note.json
 *         Some note.html
 *         image.jpg
 *       Calendar/
 *         wcherry@example.com.ics
 *
 * This module does the format-agnostic half: open the zip, work out the
 * wrapper prefix, and group the remaining entries by product directory.
 * Turning a product's entries into Neutrino data is a per-product concern
 * (`keep.ts` and `driveDocs.ts`).
 *
 * ── Why zip.js and not JSZip ──────────────────────────────────────────────
 *
 * A Takeout export is measured in gigabytes, and JSZip has no way to read one
 * without holding all of it: `loadAsync` runs the whole file through
 * `FileReader.readAsArrayBuffer` before it can tell you what is inside. That
 * put the ceiling on this feature at whatever the tab could allocate — for an
 * import that then ignores almost every byte, since the documents we want are
 * a rounding error beside the photos and videos in the same export.
 *
 * zip.js reads through a `BlobReader`, which seeks into the `File` with
 * `Blob.slice` rather than loading it. Opening an archive reads only the
 * central directory at its tail, and each `text()`/`blob()` call reads and
 * inflates just that entry's bytes. Peak memory becomes the size of the
 * largest file being converted, not the size of the archive — a 20 GB export
 * of 200 KB documents costs 200 KB at a time. Inflation also happens in a
 * worker, so a big archive no longer freezes the page.
 *
 * The cost is that the reader stays open for the life of the archive, holding
 * the `File` handle and a pool of workers, so whoever opened it should
 * `close()` it (the import page does, when another archive is chosen or the
 * page goes away).
 *
 * ── Split exports ─────────────────────────────────────────────────────────
 *
 * Google splits an export into parts at a size the user chooses when they
 * request it — 2 GB by default, so a large Photos library arrives as dozens of
 * `takeout-…-001.zip`, `-002.zip` files. The split falls between files, never
 * through one, and every part carries the same `Takeout/` wrapper, so the
 * parts are one archive that happens to be stored in several zips: part 3 can
 * hold the second half of `Google Photos/` and the whole of `Keep/`.
 *
 * `openTakeout` therefore takes either one zip or all of them, opens each, and
 * presents the union as a single `TakeoutArchive`. Nothing downstream knows
 * the difference — a product directory is the merge of that directory across
 * every part, and an entry still reads from whichever zip it came out of.
 * Reading one part at a time instead would import each in isolation, which
 * for anything Google split is wrong: albums, sidecars and the files they
 * describe routinely land in different parts.
 */

import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  configure,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';
import { formatBytes, logFail, logStep, logWarn } from './log';

/** A single file inside a product directory. */
export interface TakeoutEntry {
  /** Path relative to the product directory, e.g. `Some note.json`. */
  path: string;
  /** Full path inside the zip, e.g. `Takeout/Keep/Some note.json`. */
  fullPath: string;
  /** Lowercased extension without the dot, e.g. `json`. Empty when there is none. */
  ext: string;
  /** Uncompressed size in bytes. */
  size: number;
  /**
   * The entry's own last-modified date, out of the zip's central directory,
   * or `null` when the archive did not record one.
   *
   * The last resort for dating an imported file (`importMetadata.ts`), and the
   * only one for the products that export no metadata at all — the pictures
   * that reached Drive rather than Photos have no sidecar, so this is all
   * there is. It is a weaker signal than a sidecar: a zip stores local time
   * with no zone, and the date it carries is whatever the file had when the
   * export was built, which for some products is the export's own date.
   */
  lastModified: Date | null;
  /**
   * Read and inflate this entry. Nothing is read until called, and nothing is
   * retained afterwards, so an entry may be read more than once — the Keep
   * importer sniffs a note to identify the directory and then reads it again
   * to convert it.
   */
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

/** One product subdirectory under the archive root. */
export interface TakeoutProductDir {
  /** Directory name exactly as it appears in the zip, e.g. `Keep`. */
  name: string;
  entries: TakeoutEntry[];
}

export interface TakeoutArchive {
  /**
   * The wrapper prefix that was stripped, e.g. `Takeout/`. Empty when the zip
   * has no single wrapper directory (someone zipped the product folders
   * directly), or when the parts of a split export disagree about theirs.
   */
  root: string;
  /**
   * How many zips this archive was assembled from. `1` for an unsplit export.
   */
  partCount: number;
  products: TakeoutProductDir[];
  /** Case-insensitive lookup by directory name. */
  product(name: string): TakeoutProductDir | undefined;
  /**
   * Release the reader's worker pool, once the import is done with the
   * archive. Entries hold their own reference to the blob, so this does not
   * invalidate them — it is housekeeping, not a lifecycle boundary.
   */
  close(): Promise<void>;
}

export class TakeoutError extends Error {}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * The wrapper directory every entry shares, or `''` when they don't share one.
 *
 * Matching the literal name `Takeout` would break for non-English exports
 * (Google localises it), so this goes by shape instead: if every file in the
 * zip lives under the same single top-level directory, that directory is the
 * wrapper.
 */
function detectRoot(paths: string[]): string {
  let candidate: string | null = null;
  for (const path of paths) {
    const slash = path.indexOf('/');
    // A file at the top level means there is no single wrapper directory.
    if (slash <= 0) return '';
    const top = path.slice(0, slash);
    if (candidate === null) candidate = top;
    else if (candidate !== top) return '';
  }
  return candidate ? `${candidate}/` : '';
}

/**
 * Workers keep inflation off the main thread, which is the difference between
 * a responsive page and a frozen one on a large archive. They do not exist
 * under jsdom, so the tests run the same code inline.
 */
function configureWorkers(): void {
  configure({ useWebWorkers: typeof Worker !== 'undefined' });
}

/**
 * A zip entry's date, or `null` if there isn't a usable one.
 *
 * A zip stores the DOS timestamp in a field that is legal to leave at zero, so
 * zip.js can hand back an Invalid Date or a date in 1980. Both would be worse
 * than no date at all, since the import writes what it is given straight onto
 * the file — an "imported" 1980 is indistinguishable from a real one.
 */
function validDate(value: Date | undefined): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.getUTCFullYear() > 1980 ? value : null;
}

/** zip.js only offers `getData` on file entries; directories have no content. */
function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * A name to put in a log line or an error, for a Blob that may not have one.
 * Lower case, so that it reads as part of a sentence; `sentenceCase` puts it
 * back for the one place it starts one.
 */
function labelOf(file: Blob, index: number, total: number): string {
  if (file instanceof File && file.name) return file.name;
  return total === 1 ? 'the archive' : `archive ${index + 1}`;
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One opened zip: its own wrapper prefix, its content entries, its reader. */
interface ArchivePart {
  label: string;
  root: string;
  content: FileEntry[];
  /** Entries dropped as macOS metadata, for the log only. */
  ignored: number;
  close(): Promise<void>;
}

/**
 * Open one zip and read its central directory. Contents are not read.
 *
 * Only an unreadable zip fails here. A part that turns out to hold nothing
 * usable is not an error on its own — that judgement belongs to the merged
 * archive, since in a split export any individual part may be all photos, or
 * all sidecars, or (for the last one) very nearly empty.
 */
async function openPart(file: Blob, label: string): Promise<ArchivePart> {
  logStep('archive', `opening ${label}`, { size: formatBytes(file.size), type: file.type });

  const reader = new ZipReader(new BlobReader(file));
  let all: Entry[];
  try {
    all = await reader.getEntries();
  } catch (err) {
    logFail('archive', `${label} could not be read`, err);
    await reader.close().catch(() => {});
    throw new TakeoutError(`${sentenceCase(label)} is not a readable zip archive.`);
  }

  const close = () =>
    reader
      .close()
      .then(() => logStep('archive', `reader closed for ${label}`))
      .catch((err) => logWarn('archive', `reader would not close for ${label}`, err));

  const files = all.filter(isFileEntry);
  // macOS' Archive Utility and Finder add these; they are never real content
  // and would otherwise defeat the single-wrapper-directory detection.
  const content = files.filter((f) => {
    const name = f.filename;
    return !name.startsWith('__MACOSX/') && !name.split('/').some((p) => p === '.DS_Store');
  });

  const root = detectRoot(content.map((f) => f.filename));
  logStep('archive', `read the central directory of ${label}`, {
    entries: content.length,
    ignored: files.length - content.length,
    root: root || '(no wrapper directory)',
    // What this part would have cost to hold in memory, which is what this
    // reader exists not to pay.
    uncompressed: formatBytes(content.reduce((total, f) => total + (f.uncompressedSize ?? 0), 0)),
  });

  return { label, root, content, ignored: files.length - content.length, close };
}

/**
 * Open a Takeout export and group its contents by product directory.
 *
 * Pass one zip, or every part of a split export — see the note at the top of
 * this module. Only the zips' central directories are read here; entry
 * contents are read on demand. Files sitting directly in an archive root
 * (Takeout's `archive_browser.html` and friends) belong to no product and are
 * dropped.
 */
export async function openTakeout(source: Blob | Blob[]): Promise<TakeoutArchive> {
  const files = Array.isArray(source) ? source : [source];
  if (files.length === 0) throw new TakeoutError('No archive was chosen.');
  configureWorkers();

  // Opened in sequence rather than concurrently: each reader spins up its own
  // worker pool, and a user who drops thirty parts should not get thirty pools
  // at once. Reading a central directory is a tail seek, so this is cheap.
  const parts: ArchivePart[] = [];
  const closeAll = async () => {
    await Promise.all(parts.map((p) => p.close()));
  };
  try {
    for (const [index, file] of files.entries()) {
      parts.push(await openPart(file, labelOf(file, index, files.length)));
    }
  } catch (err) {
    await closeAll();
    throw err;
  }

  const fail = async (message: string): Promise<never> => {
    await closeAll();
    throw new TakeoutError(message);
  };

  if (parts.every((p) => p.content.length === 0)) {
    logWarn('archive', 'the archive holds no files', { parts: parts.length });
    return fail(files.length === 1 ? 'The archive is empty.' : 'Those archives are empty.');
  }

  // Only meaningful when every part agrees. Parts of one export always do;
  // a mismatch means the user mixed exports together, which is theirs to see
  // in the product list rather than something to refuse outright.
  const roots = new Set(parts.map((p) => p.root));
  const root = roots.size === 1 ? parts[0].root : '';

  const byProduct = new Map<string, TakeoutEntry[]>();
  // A path identifies a file within an export, so this is what stops a user
  // who picked the same part twice from importing everything in it twice. It
  // is deliberately not name-and-size: Google files a photo under both its
  // album and its year, and folding *those* together is the photo importer's
  // job, which it does by name and size after this has run.
  const seen = new Set<string>();
  let duplicates = 0;

  for (const part of parts) {
    for (const zipEntry of part.content) {
      const relative = zipEntry.filename.slice(part.root.length);
      const slash = relative.indexOf('/');
      // A file directly in the root (archive_browser.html) has no product.
      if (slash <= 0) continue;

      if (seen.has(zipEntry.filename)) {
        duplicates++;
        continue;
      }
      seen.add(zipEntry.filename);

      const product = relative.slice(0, slash);
      const path = relative.slice(slash + 1);
      const entry: TakeoutEntry = {
        path,
        fullPath: zipEntry.filename,
        ext: extensionOf(path),
        size: zipEntry.uncompressedSize ?? 0,
        lastModified: validDate(zipEntry.lastModDate),
        text: () => zipEntry.getData(new TextWriter()),
        blob: () => zipEntry.getData(new BlobWriter()),
      };

      const existing = byProduct.get(product);
      if (existing) existing.push(entry);
      else byProduct.set(product, [entry]);
    }
  }

  if (duplicates > 0) {
    logWarn('archive', 'the same file appeared in more than one archive', {
      dropped: duplicates,
      hint: 'the same part was probably chosen twice',
    });
  }

  if (byProduct.size === 0) {
    logWarn('archive', 'no product directories under the root', {
      sample: parts.flatMap((p) => p.content.slice(0, 10).map((f) => f.filename)).slice(0, 10),
    });
    return fail(
      'No product folders found in the archive. A Takeout export has a folder per product, such as Takeout/Keep.',
    );
  }

  const products: TakeoutProductDir[] = [...byProduct.entries()]
    .map(([name, entries]) => ({
      name,
      // Sorted across the merged set, not per part, so a product split down
      // the middle of two zips still reads in one order.
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  logStep(
    'archive',
    parts.length === 1 ? 'grouped by product' : `grouped by product across ${parts.length} archives`,
    products.map((p) => `${p.name} (${p.entries.length})`),
  );

  return {
    root,
    partCount: parts.length,
    products,
    product(name: string) {
      const wanted = name.toLowerCase();
      return products.find((p) => p.name.toLowerCase() === wanted);
    },
    close: closeAll,
  };
}
