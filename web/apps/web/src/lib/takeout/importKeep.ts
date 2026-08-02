/**
 * Running a Keep → Notes import.
 *
 * This runs in the browser rather than on the server because note content is
 * end-to-end encrypted: the per-file DEK is derived from the user's key pair,
 * which only ever exists on the device (`useEncryptedDocumentContent`). A
 * server-side importer could only write plaintext notes that the editor would
 * then fail to decrypt.
 *
 * Per note the sequence mirrors what the editor does on a first save:
 * create the note, mint a DEK and register it, upload the ciphertext, and
 * hand the plaintext to the local search index.
 */

import {
  initSodium,
  loadKeyPair,
  generateFileKey,
  encryptFileKey,
  encryptFile,
  toBase64url,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { extractNoteText } from '@neutrino/api-notes';
import { notesApi, filesystemApi, encryptionApi } from '@/lib/api';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import type { TakeoutArchive, TakeoutEntry } from './archive';
import { convertKeepNote, looksLikeKeepNote, parseKeepNote, type KeepNote } from './keep';

/** Directory names Google uses for Keep. */
const KEEP_DIR_NAMES = ['keep', 'google keep'];

export interface KeepImportOptions {
  /** Import notes Keep had archived. */
  includeArchived: boolean;
  /** Import notes sitting in Keep's trash. */
  includeTrashed: boolean;
  /** Skip a note whose title already exists, so a re-run doesn't duplicate. */
  skipExisting: boolean;
  /** Folder to import into; `null` puts the notes at the notes root. */
  folderName: string | null;
}

export const DEFAULT_KEEP_IMPORT_OPTIONS: KeepImportOptions = {
  includeArchived: true,
  includeTrashed: false,
  skipExisting: true,
  folderName: 'Google Keep',
};

export type ImportStatus = 'imported' | 'skipped' | 'failed';

export interface ImportItem {
  /** The file inside the export, e.g. `Some note.json`. */
  file: string;
  title: string;
  status: ImportStatus;
  /** Why it was skipped or how it failed. Absent for an import. */
  reason?: string;
}

export interface KeepImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: ImportItem[];
  /** Set when the notes went into a folder. */
  folderId: string | null;
  /** True when the user stopped the run before it finished. */
  cancelled: boolean;
  /**
   * True when this device holds no E2EE key pair, so the notes were written
   * as plaintext. The caller warns about it.
   */
  unencrypted: boolean;
}

export interface KeepImportProgress {
  /** Notes processed so far, including skipped and failed ones. */
  done: number;
  total: number;
  /** The note being worked on. */
  current: string;
}

export interface RunKeepImportArgs {
  entries: TakeoutEntry[];
  options: KeepImportOptions;
  /** The signed-in user; needed to find their key pair and index their notes. */
  userId: string | undefined;
  onProgress?: (progress: KeepImportProgress) => void;
  signal?: AbortSignal;
}

// ── Finding Keep inside the archive ───────────────────────────────────────────

export interface KeepSource {
  /** Directory the notes came from, for display. */
  directory: string;
  /** The `.json` note files in it. */
  entries: TakeoutEntry[];
}

/**
 * Locate the Keep notes in an archive.
 *
 * Prefers the directory named `Keep`, then falls back to sniffing every
 * product directory for JSON that parses as a Keep note — Google localises
 * the folder names, so the English name is a hint and not a guarantee.
 */
export async function findKeepNotes(archive: TakeoutArchive): Promise<KeepSource | null> {
  const named = archive.products.find((p) => KEEP_DIR_NAMES.includes(p.name.toLowerCase()));
  if (named) {
    const entries = named.entries.filter((e) => e.ext === 'json');
    if (entries.length > 0) return { directory: named.name, entries };
  }

  for (const product of archive.products) {
    const json = product.entries.filter((e) => e.ext === 'json');
    if (json.length === 0) continue;
    // One file is enough to identify the format, and reading every JSON file
    // in a large Drive export just to check would be wasteful.
    try {
      if (looksLikeKeepNote(JSON.parse(await json[0].text()))) {
        return { directory: product.name, entries: json };
      }
    } catch {
      // Not JSON we understand — try the next product.
    }
  }
  return null;
}

// ── The import ────────────────────────────────────────────────────────────────

/** Find the destination folder by name, creating it when it isn't there yet. */
async function resolveFolder(name: string): Promise<string | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const root = await filesystemApi.getRootContents();
  const existing = root.folders.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
  if (existing) return existing.id;
  const created = await filesystemApi.createFolder({ name: wanted });
  return created.id;
}

/**
 * Encrypt a note's content the way the editor's first save does, and register
 * the DEK so the editor can decrypt it later.
 *
 * The editor reads content back with `fromBase64url` before decrypting, so the
 * ciphertext has to be base64url text rather than raw bytes.
 */
async function encryptForNote(noteId: string, content: string, keyPair: KeyPair): Promise<string> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(noteId, { encryptedFileKey: encryptFileKey(dek, keyPair.publicKey) });
  return toBase64url(encryptFile(new TextEncoder().encode(content), dek));
}

/** Why this note is being skipped, or `null` to import it. */
function skipReason(note: KeepNote, options: KeepImportOptions): string | null {
  if (note.isTrashed && !options.includeTrashed) return 'In Keep’s trash';
  if (note.isArchived && !options.includeArchived) return 'Archived in Keep';
  return null;
}

export async function runKeepImport({
  entries,
  options,
  userId,
  onProgress,
  signal,
}: RunKeepImportArgs): Promise<KeepImportSummary> {
  const items: ImportItem[] = [];

  // Without a key pair on this device there is nothing to encrypt with. The
  // editor tolerates plaintext content, so the import still runs — the caller
  // surfaces `unencrypted` so the user knows.
  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;

  const folderId = options.folderName ? await resolveFolder(options.folderName) : null;

  const summary = (extra: Partial<KeepImportSummary> = {}): KeepImportSummary => ({
    total: entries.length,
    imported: items.filter((i) => i.status === 'imported').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
    folderId,
    cancelled: false,
    unencrypted: !keyPair,
    ...extra,
  });

  // Titles that already exist, so a second run over the same export is a no-op
  // rather than a second copy of every note. Only pre-existing titles count:
  // two Keep notes that genuinely share a title should both come across.
  const existingTitles = new Set<string>();
  if (options.skipExisting) {
    const notes = await notesApi.listNotes();
    for (const note of notes.notes) existingTitles.add(note.title.trim().toLowerCase());
  }

  for (const entry of entries) {
    if (signal?.aborted) return summary({ cancelled: true });

    let title = entry.path;
    try {
      const note = parseKeepNote(await entry.text());
      if (!note) {
        items.push({ file: entry.path, title, status: 'skipped', reason: 'Not a Keep note' });
        onProgress?.({ done: items.length, total: entries.length, current: title });
        continue;
      }

      const converted = convertKeepNote(note);
      title = converted.title;

      const skip = skipReason(note, options);
      if (skip) {
        items.push({ file: entry.path, title, status: 'skipped', reason: skip });
        onProgress?.({ done: items.length, total: entries.length, current: title });
        continue;
      }

      if (existingTitles.has(title.trim().toLowerCase())) {
        items.push({ file: entry.path, title, status: 'skipped', reason: 'A note with this title already exists' });
        onProgress?.({ done: items.length, total: entries.length, current: title });
        continue;
      }

      const created = await notesApi.createNote({ title, folderId });
      const content = keyPair
        ? await encryptForNote(created.id, converted.content, keyPair)
        : converted.content;

      // Keep notes contain no `[[wiki links]]`, so there is nothing for the
      // server to link up — send the empty list explicitly rather than let it
      // try to parse ciphertext.
      await notesApi.saveNote(created.id, { content, linkedTitles: [] });

      indexOnSave(userId, {
        id: created.id,
        type: 'note',
        title,
        content: extractNoteText(converted.content),
      });

      items.push({ file: entry.path, title, status: 'imported' });
    } catch (err) {
      items.push({
        file: entry.path,
        title,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    onProgress?.({ done: items.length, total: entries.length, current: title });
  }

  return summary();
}
