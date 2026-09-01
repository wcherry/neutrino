/**
 * Running a Drive → Docs import.
 *
 * Like the Keep import this runs in the browser, and for the same reason:
 * document bodies are end-to-end encrypted, so the DEK exists only on the
 * device (`useEncryptedDocumentContent`). A server-side importer could only
 * write plaintext that the editor would then fail to decrypt.
 *
 * Per document the sequence mirrors what the editor does on a first save: get
 * the file into a `.docx`, create the doc, mint a DEK and register it, upload
 * the ciphertext, and hand the flattened text to the local search index. A
 * `.docx` is what a document is stored as now (issue #127), and writing the
 * bespoke `doc.json` body instead is what left every imported document
 * reporting "Failed to open this file for editing" — issue #169.
 *
 * "Get the file into a `.docx`" is the whole of `storedDocxFor`, and for the
 * format most of an export is in, it is nothing at all: a Google Doc is
 * exported *as* a `.docx`, so the exported file is stored byte for byte. It
 * used to be run through mammoth into HTML and on into the editor's Tiptap
 * JSON, which was the right shape when a document was stored as that JSON and
 * is a lossy round trip to nowhere now that it is stored as a Word file —
 * mammoth is built to discard presentation (see `ooxml/docx/read.ts`), so
 * every colour, alignment, indent, header, footer and footnote in the export
 * was dropped on the way in and then written back out as a document that never
 * had them. `.html` and `.txt` exports still convert, because there is nothing
 * else to do with them.
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
import { DEFAULT_PAGE_SETUP, extractDocText } from '@neutrino/api-docs';
import {
  docsApi,
  driveAutosaveEncryptedBytes,
  encryptionApi,
} from '@/lib/api';
import type { LayoutMeta } from '@/lib/docBody';
import { emptyDocProperties } from '@/lib/docFields';
import { defaultHeaderFooterConfig } from '@/lib/docHeaderFooter';
import { withOoxmlExtension } from '@/lib/officeFormats';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { htmlToDocJson, textToDocJson, type PmNode } from './docHtml';
import { readDocInfo, type DriveDocEntry, type DriveDocInfo } from './driveDocs';
import { createFolderResolver } from './folders';
import { applyImportMetadata, datesFor } from './importMetadata';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import { sanitiseTitle } from './titles';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

export const UNTITLED_DOC = 'Untitled document';

/**
 * The layout an imported document lands with.
 *
 * Nothing the converters produce touches any of it — a Takeout export carries
 * no header, footer, watermark or page setup this reads — so it is the same
 * blank slate `DocEditor` starts a new document from, and the document opens at
 * the defaults rather than with them missing.
 */
function defaultLayoutMeta(): LayoutMeta {
  return {
    headerFooter: defaultHeaderFooterConfig(),
    headerText: '', footerText: '', showPageNumbers: false,
    watermarkText: '', bgColor: '', docTheme: 'default',
    properties: emptyDocProperties(),
    pageSetup: DEFAULT_PAGE_SETUP,
  };
}

/**
 * A converted document as the `.docx` the editor stores.
 *
 * `writeDocx` is the same writer the editor's own save uses, imported here
 * dynamically: it pulls the ~400KB `docx` package, which has no business in the
 * import page until a document is actually being written. `collectImageBytes`
 * decodes the `data:` images an HTML export inlines into real parts of the
 * package; an image it cannot resolve is written as a placeholder rather than
 * taking the document's only save down with it.
 */
async function buildDocxBytes(doc: PmNode, title: string): Promise<Uint8Array> {
  const { writeDocx } = await import('@/lib/ooxml/docx/write');
  const { collectImageBytes } = await import('@/lib/ooxml/docx/images');
  const model = { doc, meta: defaultLayoutMeta() };
  return writeDocx(model, { title, images: await collectImageBytes(model) });
}

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

// ── What gets stored ──────────────────────────────────────────────────────────

/**
 * One exported file as the `.docx` bytes to store for it.
 *
 * A Google Doc is exported as a `.docx` and a document is stored as a `.docx`,
 * so that case is a copy: the export goes in as it came out, and the editor
 * opens it with `readDocx` exactly as it opens any other Word file in Drive.
 * There is nothing to gain by taking it apart and rebuilding it, and a great
 * deal to lose — see the note at the top of this file.
 *
 * `.html` and `.txt` have no such shortcut, so they convert (`docHtml.ts`) and
 * are written out by `buildDocxBytes`.
 */
export async function storedDocxFor(doc: DriveDocEntry, title: string): Promise<Uint8Array> {
  if (doc.format === 'docx') {
    const bytes = new Uint8Array(await (await doc.entry.blob()).arrayBuffer());
    logStep('docs', `storing ${doc.entry.path} as exported`, { docx: formatBytes(bytes.byteLength) });
    return bytes;
  }
  const converted = doc.format === 'html'
    ? htmlToDocJson(await doc.entry.text())
    : textToDocJson(await doc.entry.text());
  const bytes = await buildDocxBytes(converted, title);
  logStep('docs', `converted ${doc.entry.path}`, {
    from: doc.format,
    docx: formatBytes(bytes.byteLength),
  });
  return bytes;
}

/**
 * The text to index a stored document by, read back out of the bytes that were
 * stored.
 *
 * Read back rather than kept from the conversion, because for a `.docx` export
 * there is no conversion to keep it from — and reading it with `readDocx`, the
 * reader the editor opens the file with, means the index holds what the editor
 * will show. It doubles as a check that the stored file parses at all.
 *
 * A failure here is a warning, not a failed import: the document is already
 * saved by the time this runs, and reporting a stored file as a failed one
 * invites a second import of the whole archive. The cost is a document that is
 * searchable by title only.
 */
async function indexTextFor(bytes: Uint8Array, file: string): Promise<string> {
  try {
    const { readDocx } = await import('@/lib/ooxml/docx/read');
    const model = await readDocx(bytes);
    return extractDocText(JSON.stringify(model.doc));
  } catch (err) {
    logWarn('docs', 'could not read the stored document back for the search index', {
      file,
      error: describeError(err),
    });
    return '';
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
 * Encrypt a document's `.docx` the way the editor's first save does, and
 * register the DEK so the editor can decrypt it later.
 *
 * The bytes go through the binary-safe transport, never the string one: a
 * `.docx` is a zip, and a `TextEncoder` round trip through it is not one any
 * more.
 */
async function saveEncrypted(
  docId: string,
  bytes: Uint8Array,
  filename: string,
  keyPair: KeyPair,
  userId: string,
): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(docId, {
    encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
    keyVersion: activeKeyVersion(userId) ?? undefined,
  });
  await driveAutosaveEncryptedBytes(docId, bytes, filename, dek);
}

export async function runDocsImport({
  docs,
  options,
  userId,
  onProgress,
  signal,
}: RunDocsImportArgs): Promise<ImportSummary> {
  const items: ImportItem[] = [];

  // Without a key pair on this device there is nothing to encrypt with, and an
  // import that writes plaintext leaves every item it touched with no key ref
  // and no way back (issue #95). So the run stops here, before the first
  // write, and the page tells the user to unlock and try again — a declined
  // import can be re-run in full; a plaintext one cannot be undone.
  logStep('docs', `starting: ${docs.length} document${docs.length === 1 ? '' : 's'}`, { options, userId });

  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair || !userId) {
    logWarn('docs', 'no key pair on this device — refusing to import, nothing was written', { userId });
    return {
      total: docs.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
      folderId: null,
      cancelled: true,
      unencrypted: true,
    } as ImportSummary;
  }
  // Narrowed together, and now unconditional: everything below encrypts.
  const encrypting = { keyPair, userId };


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
    unencrypted: false,
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

      step = 'reading the file';
      const bytes = await storedDocxFor(doc, title);

      step = 'resolving its folder';
      const parentId =
        options.preserveFolders && doc.path.length > 0
          ? await folders.folderFor([...destination, ...doc.path])
          : folderId;

      step = 'creating the document';
      const created = await docsApi.createDoc({ title, folderId: parentId });

      // Body size is the usual reason a save is rejected where a create was
      // fine: a document carries its images, so one photo-heavy export is tens
      // of megabytes.
      logStep('docs', `saving ${title}`, {
        id: created.id,
        body: formatBytes(bytes.byteLength),
        encrypted: true,
      });

      step = 'saving the encrypted body';
      await saveEncrypted(
        created.id,
        bytes,
        withOoxmlExtension(title, 'docs'),
        encrypting.keyPair,
        encrypting.userId,
      );

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
        content: await indexTextFor(bytes, file),
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
