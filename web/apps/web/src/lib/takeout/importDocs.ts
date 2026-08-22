/**
 * Running a Drive → Docs import.
 *
 * Like the Keep import this runs in the browser, and for the same reason:
 * document bodies are end-to-end encrypted, so the DEK exists only on the
 * device (`useEncryptedDocumentContent`). A server-side importer could only
 * write plaintext that the editor would then fail to decrypt.
 *
 * Per document the sequence mirrors what the editor does on a first save:
 * convert the file to the editor's Tiptap JSON, create the doc, mint a DEK and
 * register it, upload the ciphertext as `doc.json`, and hand the flattened
 * text to the local search index.
 *
 * The document's created and modified dates come across too, in a call made
 * after the body is saved — saving is what stamps the file with the current
 * time, so the dates cannot be set any earlier (`importMetadata.ts`).
 *
 * What does not come across: comments and suggestions (Takeout does not put
 * them in the exported file) and revision history. Documents are imported into
 * the folder tree the export recorded, but sharing is not reapplied, so an
 * imported copy is private to the importer.
 */

import {
  initSodium,
  loadKeyPair,
  activeKeyVersion,
  generateFileKey,
  encryptFileKey,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { extractDocText } from '@neutrino/api-docs';
import {
  docsApi,
  driveAutosaveContent,
  driveAutosaveEncryptedContent,
  encryptionApi,
} from '@/lib/api';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { htmlToDocJson, textToDocJson, type PmNode } from './docHtml';
import { readDocInfo, type DriveDocEntry, type DriveDocInfo } from './driveDocs';
import { createFolderResolver } from './folders';
import { applyImportMetadata, datesFor } from './importMetadata';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import { sanitiseTitle } from './titles';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

/** The filename every doc body is stored under, as the editor writes it. */
const CONTENT_FILENAME = 'doc.json';

export const UNTITLED_DOC = 'Untitled document';

export interface DocsImportOptions {
  /** Recreate the folder tree the export recorded, under the destination folder. */
  preserveFolders: boolean;
  /** Skip a document whose title already exists, so a re-run doesn't duplicate. */
  skipExisting: boolean;
  /** Folder to import into; `null` puts the documents at the drive root. */
  folderName: string | null;
}

export const DEFAULT_DOCS_IMPORT_OPTIONS: DocsImportOptions = {
  preserveFolders: true,
  skipExisting: true,
  folderName: 'Google Docs',
};

export interface RunDocsImportArgs {
  docs: DriveDocEntry[];
  options: DocsImportOptions;
  /** The signed-in user; needed to find their key pair and index their documents. */
  userId: string | undefined;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * Convert `.docx` bytes to HTML with mammoth, the same library the docs editor
 * uses to open a raw Word file from Drive (`docxBytesToHtml` in
 * `DocEditor.tsx`, not imported here — reaching into the editor would pull all
 * of it into the import bundle).
 *
 * The two style-map entries are the formatting mammoth drops by default:
 * underline carries meaning in a document, and Word's strikethrough character
 * style has no semantic tag of its own.
 */
export async function docxToHtml(bytes: ArrayBuffer): Promise<string> {
  const { convertToHtml } = await import('mammoth');
  const result = await convertToHtml({ arrayBuffer: bytes }, { styleMap: ['u => u', 'strike => s'] });
  // mammoth reports what it could not represent (unsupported styles, broken
  // relationships) rather than throwing, so a document that converts to less
  // than the user expects leaves its explanation here and nowhere else.
  if (result.messages?.length) {
    logWarn('docs', 'mammoth had something to say about this file', result.messages.slice(0, 20));
  }
  return result.value;
}

/** Read one exported file and convert it into the editor's document JSON. */
export async function convertDriveDoc(doc: DriveDocEntry): Promise<PmNode> {
  switch (doc.format) {
    case 'docx': {
      const bytes = await (await doc.entry.blob()).arrayBuffer();
      const html = await docxToHtml(bytes);
      logStep('docs', `converted ${doc.entry.path}`, {
        docx: formatBytes(bytes.byteLength),
        html: formatBytes(html.length),
      });
      return htmlToDocJson(html);
    }
    case 'html':
      return htmlToDocJson(await doc.entry.text());
    case 'text':
      return textToDocJson(await doc.entry.text());
  }
}

/**
 * The title to give an imported document.
 *
 * The sidecar's title is preferred over the filename because Takeout rewrites
 * filenames — characters it cannot store are replaced and `(1)` is appended to
 * disambiguate — while the sidecar records what the document was really called.
 */
function titleFor(doc: DriveDocEntry, info: DriveDocInfo | null): string {
  return sanitiseTitle(info?.title ?? '') || sanitiseTitle(doc.title) || UNTITLED_DOC;
}

// ── The import ────────────────────────────────────────────────────────────────

/**
 * Encrypt a document's content the way the editor's first save does, and
 * register the DEK so the editor can decrypt it later.
 */
async function saveEncrypted(
  docId: string,
  content: string,
  keyPair: KeyPair,
  userId: string,
): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(docId, {
    encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
    keyVersion: activeKeyVersion(userId) ?? undefined,
  });
  await driveAutosaveEncryptedContent(docId, content, CONTENT_FILENAME, dek);
}

export async function runDocsImport({
  docs,
  options,
  userId,
  onProgress,
  signal,
}: RunDocsImportArgs): Promise<ImportSummary> {
  const items: ImportItem[] = [];

  // Without a key pair on this device there is nothing to encrypt with. The
  // editor tolerates plaintext content, so the import still runs — the caller
  // surfaces `unencrypted` so the user knows.
  logStep('docs', `starting: ${docs.length} document${docs.length === 1 ? '' : 's'}`, { options, userId });

  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  // Narrowed together: a key pair exists only if a user id did.
  const encrypting = keyPair && userId ? { keyPair, userId } : null;
  if (!keyPair) {
    logWarn('docs', 'no key pair on this device — documents will be saved as plaintext', { userId });
  }

  const folders = createFolderResolver();
  const destination = options.folderName?.trim() ? [options.folderName.trim()] : [];
  const folderId = await folders.folderFor(destination);
  logStep('docs', 'destination resolved', { folder: destination.join('/') || '(drive root)', folderId });

  const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
    total: docs.length,
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
  // rather than a second copy of every document. Only pre-existing titles
  // count: two exported documents that genuinely share a title should both
  // come across.
  const existingTitles = new Set<string>();
  if (options.skipExisting) {
    const existing = await docsApi.listDocs();
    for (const doc of existing.docs) existingTitles.add(doc.title.trim().toLowerCase());
    logStep('docs', `${existingTitles.size} existing title${existingTitles.size === 1 ? '' : 's'} to skip against`);
  }

  for (const doc of docs) {
    if (signal?.aborted) {
      logStep('docs', 'stopped by the user', { done: items.length, remaining: docs.length - items.length });
      return summary({ cancelled: true });
    }

    const file = doc.entry.path;
    let title = doc.title;
    // Which step we reached, so the failure log says what was being attempted
    // rather than only what went wrong.
    let step = 'reading the title';
    try {
      // One read of the sidecar: it holds the real title and the dates Drive
      // had for the file, and it is a separate entry to inflate out of the zip.
      const info = await readDocInfo(doc.info);
      title = titleFor(doc, info);

      if (existingTitles.has(title.trim().toLowerCase())) {
        logStep('docs', `skipping ${file}`, { title, reason: 'title already exists' });
        items.push({ file, title, status: 'skipped', reason: 'A document with this title already exists' });
        onProgress?.({ done: items.length, total: docs.length, current: title });
        continue;
      }

      step = 'converting the file';
      const content = JSON.stringify(await convertDriveDoc(doc));

      step = 'resolving its folder';
      const parentId =
        options.preserveFolders && doc.path.length > 0
          ? await folders.folderFor([...destination, ...doc.path])
          : folderId;

      step = 'creating the document';
      const created = await docsApi.createDoc({ title, folderId: parentId });

      // Body size is the usual reason a save is rejected where a create was
      // fine: images arrive from mammoth as data URIs, so one photo-heavy
      // document can be tens of megabytes.
      logStep('docs', `saving ${title}`, { id: created.id, body: formatBytes(content.length), encrypted: !!keyPair });

      step = keyPair ? 'saving the encrypted body' : 'saving the body';
      if (encrypting) await saveEncrypted(created.id, content, encrypting.keyPair, encrypting.userId);
      else await driveAutosaveContent(created.id, content, CONTENT_FILENAME);

      // After the body, not before: saving it is what stamps the file with the
      // current time, so dates written any earlier would be overwritten here.
      step = 'recording the dates it had in Drive';
      await applyImportMetadata({
        fileId: created.id,
        scope: 'docs',
        source: doc.entry.fullPath,
        dates: datesFor(doc.entry, { createdAt: info?.createdAt, updatedAt: info?.modifiedAt }),
      });

      step = 'indexing it for search';
      indexOnSave(userId, {
        id: created.id,
        type: 'document',
        title,
        content: extractDocText(content),
      });

      items.push({ file, title, status: 'imported' });
    } catch (err) {
      logFail('docs', `failed while ${step}`, err, { file, title, format: doc.format, folders: doc.path });
      items.push({ file, title, status: 'failed', reason: describeError(err) });
    }

    onProgress?.({ done: items.length, total: docs.length, current: title });
  }

  const result = summary();
  logStep('docs', 'finished', {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
