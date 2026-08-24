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
 * hand the plaintext to the local search index. The note's created and edited
 * dates then go on in a final call — Keep records both, in microseconds — for
 * the reason `importMetadata.ts` explains: writing the body is what stamps the
 * file with the current time, so the dates cannot be set any earlier.
 */

import {
  initSodium,
  loadKeyPair,
  activeKeyVersion,
  generateFileKey,
  encryptFileKey,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { driveAutosaveEncryptedContent } from '@neutrino/api-drive';
import { encryptionApi } from '@/lib/api';
import { createNote, extractNoteText, listAllNotes } from '@/lib/noteFiles';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import type { TakeoutArchive, TakeoutEntry } from './archive';
import { createFolderResolver } from './folders';
import { applyImportMetadata, datesFor, isoFromEpoch } from './importMetadata';
import { convertKeepNote, looksLikeKeepNote, parseKeepNote, type KeepNote } from './keep';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

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

export type KeepImportSummary = ImportSummary;
export type KeepImportProgress = ImportProgress;

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
    logStep('keep', `using ${named.name}`, {
      matchedBy: 'name',
      json: entries.length,
      otherFiles: named.entries.length - entries.length,
    });
    if (entries.length > 0) return { directory: named.name, entries };
  }

  for (const product of archive.products) {
    const json = product.entries.filter((e) => e.ext === 'json');
    if (json.length === 0) continue;
    // One file is enough to identify the format, and reading every JSON file
    // in a large Drive export just to check would be wasteful.
    try {
      if (looksLikeKeepNote(JSON.parse(await json[0].text()))) {
        logStep('keep', `using ${product.name}`, { matchedBy: `${json[0].path} parsing as a Keep note`, json: json.length });
        return { directory: product.name, entries: json };
      }
    } catch (err) {
      // Not JSON we understand — try the next product.
      logStep('keep', `${product.name} is not Keep`, { probed: json[0].path, reason: describeError(err) });
    }
  }

  logWarn('keep', 'no Keep notes found', { products: archive.products.map((p) => p.name), looksFor: KEEP_DIR_NAMES });
  return null;
}

// ── The import ────────────────────────────────────────────────────────────────

/**
 * Encrypt a note's content the way the editor's autosave does, and register
 * the DEK so the editor can decrypt it later.
 */
async function saveEncryptedBody(
  noteId: string,
  content: string,
  keyPair: KeyPair,
  userId: string,
): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(noteId, {
    encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
    keyVersion: activeKeyVersion(userId) ?? undefined,
  });
  await driveAutosaveEncryptedContent(noteId, content, 'note.json', dek);
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

  // Without a key pair on this device there is nothing to encrypt with, and an
  // import that writes plaintext leaves every item it touched with no key ref
  // and no way back (issue #95). So the run stops here, before the first
  // write, and the page tells the user to unlock and try again — a declined
  // import can be re-run in full; a plaintext one cannot be undone.
  logStep('keep', `starting: ${entries.length} note${entries.length === 1 ? '' : 's'}`, { options, userId });

  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair || !userId) {
    logWarn('keep', 'no key pair on this device — refusing to import, nothing was written', { userId });
    return {
      total: entries.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
      folderId: null,
      cancelled: true,
      unencrypted: true,
    } as KeepImportSummary;
  }
  // Narrowed together, and now unconditional: everything below encrypts.
  const encrypting = { keyPair, userId };


  const folderId = options.folderName
    ? await createFolderResolver().folderFor([options.folderName])
    : null;

  const summary = (extra: Partial<KeepImportSummary> = {}): KeepImportSummary => ({
    total: entries.length,
    imported: items.filter((i) => i.status === 'imported').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
    folderId,
    cancelled: false,
    unencrypted: false,
    ...extra,
  });

  // Titles that already exist, so a second run over the same export is a no-op
  // rather than a second copy of every note. Only pre-existing titles count:
  // two Keep notes that genuinely share a title should both come across.
  const existingTitles = new Set<string>();
  if (options.skipExisting) {
    const notes = await listAllNotes();
    for (const note of notes) existingTitles.add(note.title.trim().toLowerCase());
  }

  for (const entry of entries) {
    if (signal?.aborted) {
      logStep('keep', 'stopped by the user', { done: items.length, remaining: entries.length - items.length });
      return summary({ cancelled: true });
    }

    let title = entry.path;
    // Which step we reached, so the failure log says what was being attempted
    // rather than only what went wrong.
    let step = 'reading the note';
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

      step = 'creating the note';
      const created = await createNote(title, folderId);

      logStep('keep', `saving ${title}`, {
        id: created.id,
        blocks: converted.blocks.length,
        body: formatBytes(converted.content.length),
        encrypted: true,
      });

      // Keep notes contain no `[[wiki links]]`, so there is nothing to link up
      // — this never calls linksApi.updateLinks, unlike the editor's save path.
      step = 'encrypting the body';
      await saveEncryptedBody(created.id, converted.content, encrypting.keyPair, encrypting.userId);

      // After the body, not before: saving it is what stamps the file with the
      // current time, so dates written any earlier would be overwritten here.
      step = 'recording the dates it had in Keep';
      await applyImportMetadata({
        fileId: created.id,
        scope: 'keep',
        source: entry.fullPath,
        dates: datesFor(entry, {
          // Keep writes both in microseconds, on every note including empty
          // ones — the most complete dates of any product in the export.
          createdAt: isoFromEpoch(note.createdTimestampUsec, 'microseconds'),
          updatedAt: isoFromEpoch(note.userEditedTimestampUsec, 'microseconds'),
        }),
      });

      step = 'indexing it for search';
      indexOnSave(userId, {
        id: created.id,
        type: 'note',
        title,
        content: extractNoteText(converted.content),
      });

      items.push({ file: entry.path, title, status: 'imported' });
    } catch (err) {
      logFail('keep', `failed while ${step}`, err, { file: entry.path, title });
      items.push({ file: entry.path, title, status: 'failed', reason: describeError(err) });
    }

    onProgress?.({ done: items.length, total: entries.length, current: title });
  }

  const result = summary();
  logStep('keep', 'finished', {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
