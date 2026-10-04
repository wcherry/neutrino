/**
 * Browsing a zip archive stored in Drive.
 *
 * ── Why the zip is opened in the browser ──────────────────────────────────
 *
 * Drive used to list a zip through `GET /drive/files/{id}/zip-contents`, which
 * opens the stored file on the server. For an end-to-end encrypted file that
 * stored file is ciphertext, so the listing failed for exactly the files most
 * people now upload — and it was only ever a listing: nothing inside could be
 * opened. Reading the archive here works the same way for both, because by the
 * time the bytes reach this module they are plaintext either way.
 *
 * ── Nothing is inflated until it is opened ────────────────────────────────
 *
 * zip.js reads through a `BlobReader` that seeks with `Blob.slice`, so opening
 * an archive reads only the central directory at its tail, and `read()`
 * inflates the one entry that was clicked — the same reasoning as
 * `lib/takeout/archive.ts` and `admin/fontArchive.ts`. The reader stays open
 * for the life of the view, so whoever opens an archive closes it.
 *
 * ── Paths are display names, not destinations ─────────────────────────────
 *
 * A zip's entry names are whatever wrote it chose: `./a/b`, `/abs/path`,
 * Windows backslashes, `../../etc/passwd`. Nothing here ever writes an entry to
 * a filesystem, so there is no zip-slip to defend against, but the names still
 * have to make a sensible tree — so they are normalised into `/`-separated
 * segments with empty, `.` and `..` segments dropped. A download takes only the
 * last segment as its filename.
 */

import {
  BlobReader,
  Uint8ArrayWriter,
  ZipReader,
  configure,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';

/** One row in a folder listing: a file in the archive or a folder of them. */
export interface ZipNode {
  /** Normalised path inside the archive, `/`-separated, no leading slash. */
  path: string;
  /** The last segment of `path`. */
  name: string;
  isDir: boolean;
  /** Uncompressed size; for a folder, the sum of everything beneath it. */
  size: number;
  /** Compressed size; for a folder, the sum of everything beneath it. */
  compressedSize: number;
  /** Last-modified time recorded in the archive, when there is one. */
  modified: Date | null;
  /** Password-protected entry — listed, but cannot be opened here. */
  encrypted: boolean;
}

export interface ZipArchive {
  /** Number of files (not folders) in the archive, metadata excluded. */
  fileCount: number;
  /** Total uncompressed size of those files. */
  totalSize: number;
  /** The folders and files directly inside `folder` (`''` is the root). */
  list(folder: string): ZipNode[];
  /** Look a node up by its normalised path. */
  node(path: string): ZipNode | undefined;
  /** Inflate one file entry. */
  readBytes(path: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Inflate one file entry into a `Blob` typed `mimeType`. */
  read(path: string, mimeType?: string): Promise<Blob>;
  /** Release the reader. Nothing can be read after this. */
  close(): Promise<void>;
}

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipArchiveError';
  }
}

/**
 * Workers keep inflation off the main thread. They do not exist under jsdom,
 * so the tests run the same code inline.
 */
function configureWorkers(): void {
  configure({ useWebWorkers: typeof Worker !== 'undefined' });
}

/** An entry name as `/`-separated segments, with the meaningless ones dropped. */
export function normalizeEntryPath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .join('/');
}

export function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * Housekeeping macOS adds when Finder builds a zip: the `__MACOSX/` shadow
 * tree, `.DS_Store`, and the `._name` resource forks beside every real file.
 * Listed, each file in a Finder-made archive would appear twice.
 */
export function isMacOsMetadata(path: string): boolean {
  if (path === '__MACOSX' || path.startsWith('__MACOSX/')) return true;
  const base = baseNameOf(path);
  return base === '.DS_Store' || base.startsWith('._');
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/** Folders first, then files, each by name the way a person would sort them. */
function compareNodes(a: ZipNode, b: ZipNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Builds the folder tree out of a flat entry list.
 *
 * Plenty of zips carry no directory entries at all — `zip -D`, most
 * programmatic writers — so every ancestor of every file is synthesised rather
 * than waiting for an entry to declare it. When two entries normalise to the
 * same path (`a/b` and `./a/b`), the later one wins, which is also what
 * extracting the archive would leave on disk.
 */
export function buildTree(entries: Array<Pick<Entry, 'filename' | 'directory' | 'uncompressedSize' | 'compressedSize' | 'lastModDate' | 'encrypted'>>): {
  nodes: Map<string, ZipNode>;
  children: Map<string, ZipNode[]>;
  sources: Map<string, number>;
} {
  const nodes = new Map<string, ZipNode>();
  const sources = new Map<string, number>();

  const ensureFolder = (path: string, modified: Date | null) => {
    const existing = nodes.get(path);
    if (existing) {
      if (!existing.isDir) {
        // A file and a folder with the same path; the folder is what makes
        // the rest of the tree reachable, so it wins.
        nodes.set(path, { ...existing, isDir: true, size: 0, compressedSize: 0, encrypted: false });
        sources.delete(path);
      }
      return;
    }
    nodes.set(path, {
      path, name: baseNameOf(path), isDir: true, size: 0, compressedSize: 0, modified, encrypted: false,
    });
  };

  entries.forEach((entry, index) => {
    const path = normalizeEntryPath(entry.filename);
    if (!path || isMacOsMetadata(path)) return;

    for (let p = parentOf(path); p; p = parentOf(p)) ensureFolder(p, null);

    const modified = entry.lastModDate instanceof Date && !Number.isNaN(entry.lastModDate.getTime())
      ? entry.lastModDate
      : null;

    if (entry.directory) {
      ensureFolder(path, modified);
      const folder = nodes.get(path)!;
      if (!folder.modified) folder.modified = modified;
      return;
    }
    if (nodes.get(path)?.isDir) return;

    nodes.set(path, {
      path,
      name: baseNameOf(path),
      isDir: false,
      size: entry.uncompressedSize ?? 0,
      compressedSize: entry.compressedSize ?? 0,
      modified,
      encrypted: Boolean(entry.encrypted),
    });
    sources.set(path, index);
  });

  const children = new Map<string, ZipNode[]>([['', []]]);
  for (const node of nodes.values()) {
    if (node.isDir && !children.has(node.path)) children.set(node.path, []);
  }
  for (const node of nodes.values()) {
    children.get(parentOf(node.path))!.push(node);
    if (!node.isDir) {
      for (let p = parentOf(node.path); p; p = parentOf(p)) {
        const folder = nodes.get(p)!;
        folder.size += node.size;
        folder.compressedSize += node.compressedSize;
      }
    }
  }
  for (const list of children.values()) list.sort(compareNodes);

  return { nodes, children, sources };
}

/** Open a zip held in a `Blob` and index its central directory. */
export async function openZipArchive(source: Blob): Promise<ZipArchive> {
  configureWorkers();
  const reader = new ZipReader(new BlobReader(source));
  let entries: Entry[];
  try {
    entries = await reader.getEntries();
  } catch {
    await reader.close().catch(() => {});
    throw new ZipArchiveError('This file is not a valid zip archive.');
  }

  const { nodes, children, sources } = buildTree(entries);
  let fileCount = 0;
  let totalSize = 0;
  for (const node of nodes.values()) {
    if (node.isDir) continue;
    fileCount += 1;
    totalSize += node.size;
  }

  async function readBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const node = nodes.get(path);
    const index = sources.get(path);
    const entry = index === undefined ? undefined : entries[index];
    if (!node || !entry || !isFileEntry(entry)) {
      throw new ZipArchiveError(`“${path}” is not a file in this archive.`);
    }
    if (node.encrypted) {
      throw new ZipArchiveError('This file is password-protected and cannot be opened here.');
    }
    return (await entry.getData(new Uint8ArrayWriter())) as Uint8Array<ArrayBuffer>;
  }

  return {
    fileCount,
    totalSize,
    list: (folder) => children.get(folder) ?? [],
    node: (path) => nodes.get(path),
    readBytes,
    // Inflated to bytes and wrapped here rather than through zip.js's
    // `BlobWriter`, whose `Blob` jsdom cannot read back — the bytes are in
    // memory either way.
    async read(path, mimeType) {
      return new Blob([await readBytes(path)], mimeType ? { type: mimeType } : {});
    },
    close: () => reader.close(),
  };
}

// ---------------------------------------------------------------------------
// What an entry can be previewed as
// ---------------------------------------------------------------------------

export type EntryPreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'unknown';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  svg: 'image/svg+xml',
};
const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml',
  'plist', 'html', 'htm', 'css', 'scss', 'less', 'ts', 'tsx', 'js', 'jsx',
  'mjs', 'cjs', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h',
  'cpp', 'hpp', 'cc', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'sql', 'graphql', 'gql', 'vue', 'svelte', 'gradle', 'lock', 'gitignore',
  'gitattributes', 'editorconfig', 'srt', 'vtt', 'tex',
]);
const TEXT_BASENAMES = new Set([
  'readme', 'license', 'licence', 'copying', 'authors', 'changelog', 'notice',
  'makefile', 'dockerfile', 'gemfile', 'rakefile', 'procfile', 'cmakelists.txt',
]);

function extensionOf(name: string): string {
  const base = baseNameOf(name);
  const dot = base.lastIndexOf('.');
  // A dotfile (`.gitignore`) is named by what follows the dot.
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** How an entry would be shown, decided from its name alone. */
export function entryPreviewKind(name: string): EntryPreviewKind {
  const ext = extensionOf(name);
  if (ext in IMAGE_TYPES) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext in VIDEO_TYPES) return 'video';
  if (ext in AUDIO_TYPES) return 'audio';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (TEXT_BASENAMES.has(baseNameOf(name).toLowerCase())) return 'text';
  return 'unknown';
}

/** The MIME type to give an entry's `Blob`, so the browser renders it right. */
export function entryMimeType(name: string): string {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'application/pdf';
  return IMAGE_TYPES[ext] ?? VIDEO_TYPES[ext] ?? AUDIO_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Whether bytes with no telling extension are text: valid UTF-8 with no NUL
 * in the first few kilobytes, which is the test `git` and `file` use.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Largest entry the viewer will inflate into memory to show. */
export const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
/** Largest entry shown as text — highlighting beyond this freezes the tab. */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
