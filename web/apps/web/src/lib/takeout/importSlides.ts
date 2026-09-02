/**
 * Running a Drive → Slides import.
 *
 * Like the other three runners this runs in the browser, and for the same
 * reason: a presentation's body is end-to-end encrypted, so the DEK exists only
 * on the device. A server-side importer could only write plaintext the editor
 * would then fail to decrypt.
 *
 * Per presentation the sequence mirrors what the editor does on a first save:
 * take the exported `.pptx`, create the presentation, mint a DEK and register
 * it, upload the ciphertext of the package, and hand the flattened slide text
 * to the local search index.
 *
 * There is no conversion step at all, and that is the point. A Google Slides
 * deck is exported *as* a `.pptx` and a Neutrino presentation *is* a `.pptx`
 * (issue #127), so the export is stored byte for byte and `SlideEditor` opens
 * it with `importFromPptx` exactly as it opens any other PowerPoint file in
 * Drive. Rebuilding it through the editor's own model on the way in would cost
 * everything pptxgenjs cannot carry — themes, transitions, gradient
 * backgrounds, speaker-note formatting — for nothing, which is the lesson
 * issue #169 taught the docs and sheets imports.
 *
 * What does not come across: comments and speaker-note revisions Google keeps
 * outside the file, animation timings PowerPoint's own format records but this
 * editor does not read, and sharing — so an imported deck is private to the
 * importer. The created and modified dates the file had in Drive do come
 * across, written after the body, since saving it is what stamps the file with
 * the current time (`importMetadata.ts`). Presentations are imported into the
 * folder tree the export recorded.
 */

import {
  initSodium,
  loadKeyPair,
  activeKeyVersion,
  generateFileKey,
  encryptFileKey,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { extractSlideText } from '@neutrino/api-slides';
import {
  slidesApi,
  driveAutosaveEncryptedBytes,
  encryptionApi,
} from '@/lib/api';
import { withOoxmlExtension } from '@/lib/officeFormats';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { readSlideInfo, type DriveSlideEntry, type DriveSlideInfo } from './driveSlides';
import { createFolderResolver } from './folders';
import { applyImportMetadata, datesFor } from './importMetadata';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import { sanitiseTitle } from './titles';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

export const UNTITLED_SLIDE = 'Untitled presentation';

export interface SlidesImportOptions {
  /** Recreate the folder tree the export recorded, under the destination folder. */
  preserveFolders: boolean;
  /** Skip a presentation whose title already exists, so a re-run doesn't duplicate. */
  skipExisting: boolean;
  /** Folder to import into; `null` puts the presentations at the drive root. */
  folderName: string | null;
}

export const DEFAULT_SLIDES_IMPORT_OPTIONS: SlidesImportOptions = {
  preserveFolders: true,
  skipExisting: true,
  folderName: 'Google Slides',
};

export interface RunSlidesImportArgs {
  slides: DriveSlideEntry[];
  options: SlidesImportOptions;
  /** The signed-in user; needed to find their key pair and index their presentations. */
  userId: string | undefined;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

// ── What gets stored ──────────────────────────────────────────────────────────

/**
 * One exported file as the `.pptx` bytes to store for it.
 *
 * The whole of it is a copy: the only format this imports is the one a
 * presentation is already stored in. It stays a function of its own so the log
 * says which file was read and how big it was, which for a deck full of images
 * is the difference between a slow import and a stuck one.
 */
export async function storedPptxFor(slide: DriveSlideEntry): Promise<Uint8Array> {
  const bytes = new Uint8Array(await (await slide.entry.blob()).arrayBuffer());
  logStep('slides', `storing ${slide.entry.path} as exported`, { pptx: formatBytes(bytes.byteLength) });
  return bytes;
}

/**
 * The text to index a stored presentation by, read back out of the bytes that
 * were stored.
 *
 * Read back with `importFromPptx` — the reader the editor opens the file with —
 * so the index holds what the editor will show, and so a deck that will not
 * parse is noticed here rather than by the user opening it. Imported
 * dynamically because it pulls JSZip and the whole PowerPoint parser, which
 * have no business in the import page until a deck is actually being read.
 *
 * A failure here is a warning, not a failed import: the presentation is already
 * saved by the time this runs, and reporting a stored file as a failed one
 * invites a second import of the whole archive. The cost is a deck that is
 * searchable by title only.
 */
async function indexTextFor(bytes: Uint8Array, filename: string, file: string): Promise<string> {
  try {
    const { importFromPptx } = await import('@/app/(apps)/slides/editor/pptxImport');
    // The cast is TypeScript's, not the runtime's: `BlobPart` is declared over
    // `ArrayBuffer` while a `Uint8Array` is typed over `ArrayBufferLike`, and
    // copying the buffer to satisfy that would duplicate a deck-sized array.
    const presentation = await importFromPptx(new File([bytes as BlobPart], filename));
    return extractSlideText(JSON.stringify(presentation));
  } catch (err) {
    logWarn('slides', 'could not read the stored presentation back for the search index', {
      file,
      error: describeError(err),
    });
    return '';
  }
}

/**
 * The title to give an imported presentation.
 *
 * As with documents and spreadsheets the sidecar's title wins over the
 * filename, because Takeout rewrites filenames — characters it cannot store are
 * replaced and `(1)` is appended to disambiguate — while the sidecar records
 * what the presentation was really called.
 */
function titleFor(slide: DriveSlideEntry, info: DriveSlideInfo | null): string {
  return sanitiseTitle(info?.title ?? '') || sanitiseTitle(slide.title) || UNTITLED_SLIDE;
}

// ── The import ────────────────────────────────────────────────────────────────

/**
 * Encrypt a presentation's package the way the editor's first save does, and
 * register the DEK so the editor can decrypt it later.
 *
 * The bytes go through the binary-safe transport, never the string one: a
 * `.pptx` is a zip, and a `TextEncoder` round trip through it is not a package
 * any more.
 */
async function saveEncrypted(
  slideId: string,
  bytes: Uint8Array,
  filename: string,
  keyPair: KeyPair,
  userId: string,
): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(slideId, {
    encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
    keyVersion: activeKeyVersion(userId) ?? undefined,
  });
  await driveAutosaveEncryptedBytes(slideId, bytes, filename, dek);
}

export async function runSlidesImport({
  slides,
  options,
  userId,
  onProgress,
  signal,
}: RunSlidesImportArgs): Promise<ImportSummary> {
  const items: ImportItem[] = [];

  logStep('slides', `starting: ${slides.length} presentation${slides.length === 1 ? '' : 's'}`, {
    options,
    userId,
  });

  // Without a key pair on this device there is nothing to encrypt with, and an
  // import that writes plaintext leaves every item it touched with no key ref
  // and no way back (issue #95). So the run stops here, before the first
  // write, and the page tells the user to unlock and try again — a declined
  // import can be re-run in full; a plaintext one cannot be undone.
  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair || !userId) {
    logWarn('slides', 'no key pair on this device — refusing to import, nothing was written', { userId });
    return {
      total: slides.length,
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
  logStep('slides', 'destination resolved', { folder: destination.join('/') || '(drive root)', folderId });

  const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
    total: slides.length,
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
  // rather than a second copy of every presentation. Only pre-existing titles
  // count: two exported decks that genuinely share a title should both come
  // across.
  const existingTitles = new Set<string>();
  if (options.skipExisting) {
    const existing = await slidesApi.listSlides();
    for (const slide of existing.slides) existingTitles.add(slide.title.trim().toLowerCase());
    logStep('slides', `${existingTitles.size} existing title${existingTitles.size === 1 ? '' : 's'} to skip against`);
  }

  for (const slide of slides) {
    if (signal?.aborted) {
      logStep('slides', 'stopped by the user', { done: items.length, remaining: slides.length - items.length });
      return summary({ cancelled: true });
    }

    const file = slide.entry.path;
    let title = slide.title;
    // Which step we reached, so the failure log says what was being attempted
    // rather than only what went wrong.
    let step = 'reading the title';
    try {
      // One read of the sidecar: it holds the real title and the dates Drive
      // had for the file, and it is a separate entry to inflate out of the zip.
      const info = await readSlideInfo(slide.info);
      title = titleFor(slide, info);

      if (existingTitles.has(title.trim().toLowerCase())) {
        logStep('slides', `skipping ${file}`, { title, reason: 'title already exists' });
        items.push({ file, title, status: 'skipped', reason: 'A presentation with this title already exists' });
        onProgress?.({ done: items.length, total: slides.length, current: title });
        continue;
      }

      step = 'reading the file';
      const bytes = await storedPptxFor(slide);

      step = 'resolving its folder';
      const parentId =
        options.preserveFolders && slide.path.length > 0
          ? await folders.folderFor([...destination, ...slide.path])
          : folderId;

      step = 'creating the presentation';
      // Drive creates the record with no body — a `.pptx` is a zip the server
      // has no business building — and the save below is what fills it.
      const created = await slidesApi.createSlide({ title, folderId: parentId });

      // Body size is the usual reason a save is rejected where a create was
      // fine: a deck carries its images, so one photo-heavy presentation is
      // tens of megabytes.
      logStep('slides', `saving ${title}`, {
        id: created.id,
        body: formatBytes(bytes.byteLength),
        encrypted: true,
      });

      const filename = withOoxmlExtension(title, 'slides');
      step = 'saving the encrypted body';
      await saveEncrypted(created.id, bytes, filename, encrypting.keyPair, encrypting.userId);

      // After the body, not before: saving it is what stamps the file with the
      // current time, so dates written any earlier would be overwritten here.
      step = 'recording the dates it had in Drive';
      await applyImportMetadata({
        fileId: created.id,
        scope: 'slides',
        source: slide.entry.fullPath,
        dates: datesFor(slide.entry, { createdAt: info?.createdAt, updatedAt: info?.modifiedAt }),
      });

      step = 'indexing it for search';
      indexOnSave(userId, {
        id: created.id,
        type: 'slide',
        title,
        content: await indexTextFor(bytes, filename, file),
      });

      items.push({ file, title, status: 'imported' });
    } catch (err) {
      logFail('slides', `failed while ${step}`, err, { file, title, format: slide.format, folders: slide.path });
      items.push({ file, title, status: 'failed', reason: describeError(err) });
    }

    onProgress?.({ done: items.length, total: slides.length, current: title });
  }

  const result = summary();
  logStep('slides', 'finished', {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
