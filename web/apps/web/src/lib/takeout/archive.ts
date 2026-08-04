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
   * directly).
   */
  root: string;
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

/** zip.js only offers `getData` on file entries; directories have no content. */
function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * Open a Takeout zip and group its contents by product directory.
 *
 * Only the zip's central directory is read here; entry contents are read on
 * demand. Files sitting directly in the archive root (Takeout's
 * `archive_browser.html` and friends) belong to no product and are dropped.
 */
export async function openTakeout(file: Blob): Promise<TakeoutArchive> {
  logStep('archive', 'opening zip', { size: formatBytes(file.size), type: file.type });
  configureWorkers();

  const reader = new ZipReader(new BlobReader(file));
  let all: Entry[];
  try {
    all = await reader.getEntries();
  } catch (err) {
    logFail('archive', 'zip could not be read', err);
    await reader.close().catch(() => {});
    throw new TakeoutError('That file is not a readable zip archive.');
  }

  const close = () =>
    reader
      .close()
      .then(() => logStep('archive', 'reader closed'))
      .catch((err) => logWarn('archive', 'reader would not close', err));

  const fail = async (message: string): Promise<never> => {
    await close();
    throw new TakeoutError(message);
  };

  const files = all.filter(isFileEntry);
  if (files.length === 0) {
    logWarn('archive', 'zip holds no files');
    return fail('The archive is empty.');
  }

  // macOS' Archive Utility and Finder add these; they are never real content
  // and would otherwise defeat the single-wrapper-directory detection.
  const content = files.filter((f) => {
    const name = f.filename;
    return !name.startsWith('__MACOSX/') && !name.split('/').some((p) => p === '.DS_Store');
  });
  if (content.length === 0) {
    logWarn('archive', 'zip holds nothing but macOS metadata', { entries: files.length });
    return fail('The archive is empty.');
  }

  const root = detectRoot(content.map((f) => f.filename));
  logStep('archive', 'read the central directory', {
    entries: content.length,
    ignored: files.length - content.length,
    root: root || '(no wrapper directory)',
    // What the archive would have cost to hold in memory, which is what this
    // reader exists not to pay.
    uncompressed: formatBytes(content.reduce((total, f) => total + (f.uncompressedSize ?? 0), 0)),
  });

  const byProduct = new Map<string, TakeoutEntry[]>();
  for (const zipEntry of content) {
    const relative = zipEntry.filename.slice(root.length);
    const slash = relative.indexOf('/');
    // A file directly in the root (archive_browser.html) has no product.
    if (slash <= 0) continue;

    const product = relative.slice(0, slash);
    const path = relative.slice(slash + 1);
    const entry: TakeoutEntry = {
      path,
      fullPath: zipEntry.filename,
      ext: extensionOf(path),
      size: zipEntry.uncompressedSize ?? 0,
      text: () => zipEntry.getData(new TextWriter()),
      blob: () => zipEntry.getData(new BlobWriter()),
    };

    const existing = byProduct.get(product);
    if (existing) existing.push(entry);
    else byProduct.set(product, [entry]);
  }

  if (byProduct.size === 0) {
    logWarn('archive', 'no product directories under the root', {
      sample: content.slice(0, 10).map((f) => f.filename),
    });
    return fail(
      'No product folders found in the archive. A Takeout export has a folder per product, such as Takeout/Keep.',
    );
  }

  const products: TakeoutProductDir[] = [...byProduct.entries()]
    .map(([name, entries]) => ({
      name,
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  logStep(
    'archive',
    'grouped by product',
    products.map((p) => `${p.name} (${p.entries.length})`),
  );

  return {
    root,
    products,
    product(name: string) {
      const wanted = name.toLowerCase();
      return products.find((p) => p.name.toLowerCase() === wanted);
    },
    close,
  };
}
