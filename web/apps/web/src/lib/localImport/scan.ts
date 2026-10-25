/**
 * Turning what the user picked into the local import's raw material.
 *
 * Three ways in — a folder input (`webkitRelativePath`), a plain file input,
 * and a drop (`webkitGetAsEntry` directory walking) — all produce the same
 * relative, '/'-joined paths, because the path is both the folder structure the
 * import recreates and the key a retry finds a file by.
 *
 * Nothing here reads a file's contents. A scan of ten thousand photos holds ten
 * thousand `File` handles, which cost next to nothing; the bytes are read one
 * upload at a time, later.
 */

import { classifyFile, IMPORT_KINDS, isIgnoredPath, mimeTypeFor, type ImportKind } from './classify';

export interface PickedFile {
  file: File;
  /** '/'-joined, relative, including the top folder; a loose file is its name. */
  path: string;
}

export interface LocalImportFile extends PickedFile {
  kind: ImportKind;
  mimeType: string;
}

export interface KindTotals {
  count: number;
  bytes: number;
}

export interface ScanResult {
  files: LocalImportFile[];
  totalBytes: number;
  byKind: Record<ImportKind, KindTotals>;
  /** OS clutter (.DS_Store, Thumbs.db, …) left out of everything above. */
  ignored: number;
  /** Top-level folder names, sorted; loose files have none. */
  roots: string[];
}

function emptyTotals(): Record<ImportKind, KindTotals> {
  const totals = {} as Record<ImportKind, KindTotals>;
  for (const kind of IMPORT_KINDS) totals[kind] = { count: 0, bytes: 0 };
  return totals;
}

export function scanFiles(picked: Iterable<PickedFile>): ScanResult {
  const files: LocalImportFile[] = [];
  const byKind = emptyTotals();
  const roots = new Set<string>();
  let totalBytes = 0;
  let ignored = 0;

  for (const { file, path } of picked) {
    if (isIgnoredPath(path)) {
      ignored++;
      continue;
    }
    const mimeType = mimeTypeFor(file.name, file.type);
    const kind = classifyFile(file.name, mimeType);
    files.push({ file, path, kind, mimeType });
    byKind[kind].count++;
    byKind[kind].bytes += file.size;
    totalBytes += file.size;
    const slash = path.indexOf('/');
    if (slash > 0) roots.add(path.slice(0, slash));
  }

  return { files, totalBytes, byKind, ignored, roots: [...roots].sort((a, b) => a.localeCompare(b)) };
}

/** A folder or file input's selection. A folder input reports `webkitRelativePath`. */
export function pickedFromFileList(list: FileList | File[]): PickedFile[] {
  return Array.from(list, (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

// ── Drops ─────────────────────────────────────────────────────────────────────

/**
 * The parts of the File and Directory Entries API a drop uses. Declared here
 * rather than taken from lib.dom so a test can hand in a plain object.
 */
interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, failure?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (err: unknown) => void) => void;
  };
}

function relativePath(entry: DroppedEntry): string {
  const full = entry.fullPath || entry.name;
  return full.replace(/^\/+/, '');
}

function fileOf(entry: DroppedEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error(`${entry.name} is not a file`));
      return;
    }
    entry.file(resolve, reject);
  });
}

/** Every child of a directory. `readEntries` returns them in batches (100 in Chrome) until `[]`. */
async function childrenOf(entry: DroppedEntry): Promise<DroppedEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(entry: DroppedEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    out.push({ file: await fileOf(entry), path: relativePath(entry) });
    return;
  }
  if (entry.isDirectory) {
    for (const child of await childrenOf(entry)) await walk(child, out);
  }
}

/**
 * The files in a drop, walking any dropped folders.
 *
 * The entries are taken out of `dt.items` synchronously, before the first
 * `await`: a `DataTransfer` is emptied once the drop event's handler returns,
 * so anything read from it after that sees nothing.
 */
export async function pickedFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries: DroppedEntry[] = [];
  const items = Array.from(dt.items ?? []);
  for (const item of items) {
    if (item.kind !== 'file' || typeof item.webkitGetAsEntry !== 'function') continue;
    // lib.dom's FileSystemEntry has the members `DroppedEntry` names.
    const entry = item.webkitGetAsEntry() as DroppedEntry | null;
    if (entry) entries.push(entry);
  }
  // No entry API (or nothing it could describe): the flat file list is all there is.
  const fallback = entries.length === 0 ? Array.from(dt.files ?? []) : [];

  if (entries.length === 0) return pickedFromFileList(fallback);

  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}
