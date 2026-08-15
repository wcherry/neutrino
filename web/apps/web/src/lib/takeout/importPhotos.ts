/**
 * Running a Google Photos → Photos import.
 *
 * Like the other runners this works in the browser, and for the same reason:
 * the Photos app uploads encrypted (`uploadEncryptedFile` + `registerPhoto`,
 * as `photos/page.tsx` does), so the DEK exists only on this device. It also
 * has to be the browser for a second reason here — a thumbnail. The server
 * cannot make one from a file it cannot decrypt, so an encrypted photo's
 * preview is generated on the device at upload time and sent alongside; skip
 * it and the library is a grid of blank tiles.
 *
 * Per photo: read the bytes out of the zip, make a thumbnail, upload the
 * original encrypted, register it with the capture date from Google's sidecar,
 * star and archive it to match, and add it to the albums it was in.
 *
 * What does not come across: Google's people tags and face groupings (Neutrino
 * detects its own), memories, comments on shared albums, and the edits Google
 * stored separately — a `-edited` copy in the export is imported as its own
 * photo, since it is the version the user chose to keep. Location and camera
 * details are not read from the sidecar at all: the original file is uploaded
 * untouched, so its EXIF arrives with it and the server reads them from there.
 */

import {
  initSodium,
  loadKeyPair,
  generateFileKey,
  encryptFileKey,
  encryptMetadata,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { generateThumbnail } from '@neutrino/api-photos';
import {
  albumsApi,
  filesystemApi,
  photosApi,
  storageApi,
  uploadEncryptedFile,
  getCurrentUserId,
} from '@/lib/api';
import { createFolderResolver } from './folders';
import { readPhotoInfo, type TakeoutPhoto } from './photos';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

export interface PhotosImportOptions {
  /** Recreate Google's albums and put the photos back in them. */
  importAlbums: boolean;
  /** Import photos Google Photos had archived, and archive them here too. */
  includeArchived: boolean;
  /** Import photos sitting in Google's trash. */
  includeTrashed: boolean;
  /** Skip a photo whose filename is already in the destination, so a re-run doesn't duplicate. */
  skipExisting: boolean;
  /** Drive folder to upload into; `null` puts the files at the drive root. */
  folderName: string | null;
}

export const DEFAULT_PHOTOS_IMPORT_OPTIONS: PhotosImportOptions = {
  importAlbums: true,
  includeArchived: true,
  includeTrashed: false,
  skipExisting: true,
  folderName: 'Google Photos',
};

export interface RunPhotosImportArgs {
  photos: TakeoutPhoto[];
  options: PhotosImportOptions;
  /** The signed-in user; needed to find their key pair and their existing photos. */
  userId: string | undefined;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

/** How many files to ask for per page when listing what is already there. */
const LISTING_LIMIT = 500;

/**
 * How many pages of existing files to read before giving up on the
 * skip-existing check. A photo library is the one import that can genuinely
 * run to tens of thousands of files, and paging is the only way the check
 * stays true past the first page — but it cannot page forever either.
 */
const MAX_LISTING_PAGES = 100;

// ── What is already there ─────────────────────────────────────────────────────

/**
 * The filenames already in the destination folder.
 *
 * Scoped to the destination rather than to the whole library because that is
 * where a previous run of this import put its files, and it is the question
 * being asked: has this archive already been imported here?
 */
async function existingFileNames(folderId: string | null): Promise<Set<string>> {
  const names = new Set<string>();
  const rootId = folderId ?? getCurrentUserId();
  if (!rootId) return names;

  for (let page = 0; page < MAX_LISTING_PAGES; page++) {
    const contents = await filesystemApi.getFolderContents(rootId, {
      limit: LISTING_LIMIT,
      offset: page * LISTING_LIMIT,
    });
    for (const file of contents.files) names.add(file.name.trim().toLowerCase());
    if (contents.files.length < LISTING_LIMIT) return names;
  }

  logWarn('photos', `stopped listing existing files after ${MAX_LISTING_PAGES} pages`, {
    counted: names.size,
    consequence: 'a photo beyond that may be imported a second time',
  });
  return names;
}

// ── Albums ────────────────────────────────────────────────────────────────────

interface AlbumResolver {
  /** The id of the album called `title`, creating it if it is not there yet. */
  albumFor(title: string): Promise<string>;
}

/**
 * Albums by title, created on demand and remembered.
 *
 * The existing albums are read once, on the first photo that needs one, so an
 * import with no albums in it makes no album calls at all. Matching an
 * existing album by title is what stops a second run of the same archive
 * building a second "Rome".
 */
function createAlbumResolver(): AlbumResolver {
  const byTitle = new Map<string, string>();
  let loaded = false;

  async function albumFor(title: string): Promise<string> {
    if (!loaded) {
      const existing = await albumsApi.listAlbums();
      for (const album of existing.albums) byTitle.set(album.title.trim().toLowerCase(), album.id);
      loaded = true;
      logStep('photos', `${byTitle.size} existing album${byTitle.size === 1 ? '' : 's'}`);
    }
    const key = title.trim().toLowerCase();
    const known = byTitle.get(key);
    if (known) return known;

    const created = await albumsApi.createAlbum({ title });
    byTitle.set(key, created.id);
    logStep('photos', `created album ${title}`, { id: created.id });
    return created.id;
  }

  return { albumFor };
}

// ── Uploading ─────────────────────────────────────────────────────────────────

/**
 * Upload one photo's bytes and return the Drive file id.
 *
 * The encrypted path mirrors what the Photos app's own upload does, down to
 * the encrypted metadata blob holding the real name and type — the file row
 * itself only carries the ciphertext.
 */
async function uploadPhotoFile(
  file: File,
  thumbnailB64: string | null,
  folderId: string | null,
  keyPair: KeyPair | null,
): Promise<string> {
  if (!keyPair) {
    const item = await storageApi.uploadFile(file, undefined, folderId);
    return item.id;
  }
  const dek = generateFileKey();
  const item = await uploadEncryptedFile(
    file,
    dek,
    encryptFileKey(dek, keyPair.publicKey),
    encryptMetadata({ name: file.name, mimeType: file.type || 'application/octet-stream' }, dek),
    undefined,
    folderId,
    thumbnailB64,
  );
  return item.id;
}

// ── The import ────────────────────────────────────────────────────────────────

export async function runPhotosImport({
  photos,
  options,
  userId,
  onProgress,
  signal,
}: RunPhotosImportArgs): Promise<ImportSummary> {
  const items: ImportItem[] = [];

  logStep('photos', `starting: ${photos.length} file${photos.length === 1 ? '' : 's'}`, { options, userId });

  // Without a key pair on this device there is nothing to encrypt with. The
  // Photos app refuses to upload at all in that state; the import goes ahead
  // unencrypted — the caller surfaces `unencrypted` so the user knows — because
  // a half-imported library is worse than a plaintext one.
  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair) {
    logWarn('photos', 'no key pair on this device — photos will be uploaded unencrypted', { userId });
  }

  const folders = createFolderResolver();
  const destination = options.folderName?.trim() ? [options.folderName.trim()] : [];
  const folderId = await folders.folderFor(destination);
  logStep('photos', 'destination resolved', { folder: destination.join('/') || '(drive root)', folderId });

  const albums = createAlbumResolver();

  const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
    total: photos.length,
    imported: items.filter((i) => i.status === 'imported').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
    folderId,
    cancelled: false,
    unencrypted: !keyPair,
    ...extra,
  });

  const existing = options.skipExisting ? await existingFileNames(folderId) : new Set<string>();
  if (options.skipExisting) {
    logStep('photos', `${existing.size} existing file${existing.size === 1 ? '' : 's'} to skip against`);
  }

  for (const photo of photos) {
    if (signal?.aborted) {
      logStep('photos', 'stopped by the user', { done: items.length, remaining: photos.length - items.length });
      return summary({ cancelled: true });
    }

    const file = photo.entry.path;
    const title = photo.title;
    const skip = (reason: string) => {
      logStep('photos', `skipping ${file}`, { reason });
      items.push({ file, title, status: 'skipped', reason });
      onProgress?.({ done: items.length, total: photos.length, current: title });
    };

    if (photo.trashed && !options.includeTrashed) {
      skip('In Google’s trash');
      continue;
    }
    if (photo.archived && !options.includeArchived) {
      skip('Archived in Google Photos');
      continue;
    }
    if (existing.has(title.trim().toLowerCase())) {
      skip('A file with this name is already there');
      continue;
    }

    // Which step we reached, so the failure log says what was being attempted
    // rather than only what went wrong.
    let step = 'reading it from the archive';
    try {
      const blob = await photo.entry.blob();
      const media = new File([blob], title, { type: photo.mimeType });

      // Only images have a thumbnail worth making, and only some of those: a
      // format the browser cannot decode (HEIC outside Safari, most raw files)
      // returns nothing rather than failing, and the photo imports without a
      // preview instead of not at all.
      step = 'making a thumbnail';
      const thumbnail = photo.kind === 'image' ? await generateThumbnail(media) : null;

      step = 'uploading it';
      logStep('photos', `uploading ${title}`, {
        size: formatBytes(media.size),
        kind: photo.kind,
        thumbnail: thumbnail !== null,
        encrypted: !!keyPair,
      });
      const fileId = await uploadPhotoFile(media, thumbnail, folderId, keyPair);

      step = 'registering it in Photos';
      const info = await readPhotoInfo(photo.info);
      const registered = await photosApi.registerPhoto({ fileId, captureDate: info?.takenAt ?? null });

      // Registering always starts a photo unstarred and unarchived, so both
      // flags are a second call — made only when there is something to say.
      const starred = info?.favorite === true;
      const archived = photo.archived;
      if (starred || archived) {
        step = 'restoring its starred and archived state';
        await photosApi.updatePhoto(registered.id, {
          ...(starred ? { isStarred: true } : {}),
          ...(archived ? { isArchived: true } : {}),
        });
      }

      if (options.importAlbums && photo.albums.length > 0) {
        step = 'adding it to its albums';
        for (const album of photo.albums) {
          await albumsApi.addPhoto(await albums.albumFor(album), registered.id);
        }
      }

      items.push({ file, title, status: 'imported' });
    } catch (err) {
      logFail('photos', `failed while ${step}`, err, { file, title, kind: photo.kind, albums: photo.albums });
      items.push({ file, title, status: 'failed', reason: describeError(err) });
    }

    onProgress?.({ done: items.length, total: photos.length, current: title });
  }

  const result = summary();
  logStep('photos', 'finished', {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
