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
 * (`keep.ts` is the only one implemented so far).
 */

import JSZip from 'jszip';

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
 * Open a Takeout zip and group its contents by product directory.
 *
 * Files sitting directly in the archive root (Takeout's `archive_browser.html`
 * and friends) belong to no product and are dropped.
 */
export async function openTakeout(file: Blob): Promise<TakeoutArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new TakeoutError('That file is not a readable zip archive.');
  }

  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length === 0) {
    throw new TakeoutError('The archive is empty.');
  }

  // macOS' Archive Utility and Finder add these; they are never real content
  // and would otherwise defeat the single-wrapper-directory detection.
  const content = files.filter((f) => {
    const name = f.name;
    return !name.startsWith('__MACOSX/') && !name.split('/').some((p) => p === '.DS_Store');
  });
  if (content.length === 0) {
    throw new TakeoutError('The archive is empty.');
  }

  const root = detectRoot(content.map((f) => f.name));

  const byProduct = new Map<string, TakeoutEntry[]>();
  for (const zipEntry of content) {
    const relative = zipEntry.name.slice(root.length);
    const slash = relative.indexOf('/');
    // A file directly in the root (archive_browser.html) has no product.
    if (slash <= 0) continue;

    const product = relative.slice(0, slash);
    const path = relative.slice(slash + 1);
    const entry: TakeoutEntry = {
      path,
      fullPath: zipEntry.name,
      ext: extensionOf(path),
      // JSZip exposes the uncompressed size on an internal field that is not
      // in its public types; absent on some archives, hence the fallback.
      size: (zipEntry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
      text: () => zipEntry.async('string'),
      blob: () => zipEntry.async('blob'),
    };

    const existing = byProduct.get(product);
    if (existing) existing.push(entry);
    else byProduct.set(product, [entry]);
  }

  if (byProduct.size === 0) {
    throw new TakeoutError(
      'No product folders found in the archive. A Takeout export has a folder per product, such as Takeout/Keep.',
    );
  }

  const products: TakeoutProductDir[] = [...byProduct.entries()]
    .map(([name, entries]) => ({
      name,
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    root,
    products,
    product(name: string) {
      const wanted = name.toLowerCase();
      return products.find((p) => p.name.toLowerCase() === wanted);
    },
  };
}
