/**
 * Choosing a Live Photo's key photo — and taking it back (issue #317).
 *
 * The still is replaced by a frame of its own clip, **as a new Drive version of
 * the same file**: same id, so albums, favourites, shares and the Live Photo
 * pairing (by `liveVideoFileID` and by stem) all keep working, and the original
 * stays in version history as *Original key photo*. The clip's
 * `still-image-time` sample is moved to the chosen frame in place
 * (`quicktime.ts`), so Apple Photos settles the motion on the new still when
 * the photo goes back to an iPhone.
 *
 * Both entry points — the viewer's **Choose Key Photo** and the editor's **Key
 * Photo** tool — come through here; neither UI writes anything itself.
 *
 * **Two files change, so order and rollback matter.** Both are snapshotted
 * first; then the clip is written, then the still, then the photo record. If a
 * later step fails, the files already written are put back from the bytes held
 * in memory, so a photo never ends up with a new still on an old clip or the
 * other way round. A clip whose layout `rewriteStillImageTime` does not
 * recognise is not a failure: it is left alone, the rest goes ahead, and the
 * caller is told so it can warn.
 *
 * **Revert** writes both originals back through the same route — not
 * `/versions/{id}/restore`, which restores bytes but not the file's name or
 * type — and clears `keyPhoto` from the record.
 *
 * Every network and DOM effect is a dependency (`KeyPhotoDeps`), so the whole
 * sequence, rollback and the 409 included, is tested against fakes.
 */

import { rewriteStillImageTime } from './quicktime';
import type { PhotoMetadata, PhotoResponse } from './index';

/** The label on the first snapshot of each file; never pruned (it is a named version). */
export const ORIGINAL_KEY_PHOTO_LABEL = 'Original key photo';
/** The label on later snapshots, taken before each further change. */
export const KEY_PHOTO_LABEL = 'Key photo';

/** What the photo record remembers about a changed key photo. */
export interface KeyPhotoRecord {
  /** The still's *Original key photo* version. */
  originalVersionId: string;
  originalName: string;
  originalMimeType: string;
  /** The clip's *Original key photo* version, once the clip has been rewritten. */
  clipOriginalVersionId: string | null;
  /** The key-frame time before any change, or null when the clip had none readable. */
  originalStillImageTime: number | null;
  clipRewritten: boolean;
  frameSeconds: number;
  changedAt: string;
  originalWidth?: number;
  originalHeight?: number;
}

/** The record's `keyPhoto`, if the key photo has been changed. */
export function keyPhotoOf(photo: Pick<PhotoResponse, 'metadata'> | null | undefined): KeyPhotoRecord | null {
  const value = (photo?.metadata as (PhotoMetadata & { keyPhoto?: unknown }) | null | undefined)?.keyPhoto;
  if (!value || typeof value !== 'object') return null;
  const record = value as KeyPhotoRecord;
  return typeof record.originalVersionId === 'string' ? record : null;
}

/** One of the two files, as the caller loaded it. */
export interface KeyPhotoFile {
  fileId: string;
  name: string;
  mimeType: string;
  /** The `contentVersion` the caller read; a write against anything newer is refused. */
  contentVersion: number;
  /** Its decrypted bytes, as they are now. */
  plain: Uint8Array;
}

export interface KeyPhotoFrame {
  /** The frame as a JPEG, already carrying the original's EXIF (`exif.ts`). */
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Where in the clip it was taken. */
  seconds: number;
  /** A small JPEG of the frame for the Drive thumbnails, base64. */
  thumbnailB64: string | null;
}

export interface KeyPhotoDeps {
  /** The file's DEK. */
  fileKey(fileId: string): Promise<Uint8Array>;
  /** The file's `contentVersion` and cover thumbnail URL as the server has them now. */
  fileState(fileId: string): Promise<{ contentVersion: number; coverThumbnailUrl: string | null }>;
  /** Snapshot `plain` (encrypted with `dek`) as a named version; answers its id. */
  saveVersion(fileId: string, plain: Uint8Array, dek: Uint8Array, label: string): Promise<{ id: string }>;
  /** Write `plain` as the live content, guarded by `expectedContentVersion`; answers the new `contentVersion`. */
  replace(
    fileId: string,
    plain: Uint8Array,
    dek: Uint8Array,
    extras: { name?: string; mimeType?: string; thumbnailB64?: string | null },
    expectedContentVersion: number,
  ): Promise<{ contentVersion: number }>;
  /** A version's decrypted bytes. */
  versionBytes(fileId: string, versionId: string, dek: Uint8Array): Promise<Uint8Array>;
  /** The current cover thumbnail as base64, to put back on rollback; null when there is none. */
  currentThumbnail(coverThumbnailUrl: string | null): Promise<string | null>;
  /** Merge `patch` into the photo's metadata (RFC 7396). */
  mergePhotoMetadata(photoId: string, patch: Record<string, unknown>): Promise<unknown>;
  /** Base64 thumbnails for the originals on revert. */
  imageThumbnail(plain: Uint8Array, mimeType: string): Promise<string | null>;
  clipThumbnail(plain: Uint8Array, atSeconds: number | null): Promise<string | null>;
  /** Drop face boxes etc. computed from the old pixels and queue them again. Best effort. */
  resetDerivedData?(photoId: string): Promise<void>;
}

/** The server holds a newer revision of one of the files than the caller loaded. */
export class KeyPhotoConflictError extends Error {
  constructor() {
    super('This photo changed somewhere else. Reload it and try again.');
    this.name = 'KeyPhotoConflictError';
  }
}

function isConflict(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 409 || e?.code === 'CONTENT_VERSION_CONFLICT';
}

/** `IMG_1234.HEIC` → `IMG_1234.JPG`; the stem is kept, so stem pairing still holds. */
export function keyPhotoFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const upper = ext.length > 0 && ext === ext.toUpperCase();
  return `${stem}.${upper ? 'JPG' : 'jpg'}`;
}

async function assertCurrent(deps: KeyPhotoDeps, file: Pick<KeyPhotoFile, 'fileId' | 'contentVersion'>) {
  const state = await deps.fileState(file.fileId);
  if (state.contentVersion !== file.contentVersion) throw new KeyPhotoConflictError();
  return state;
}

/** Run `step`; on failure run `undo` (best effort) and rethrow, a 409 as `KeyPhotoConflictError`. */
async function withRollback<T>(step: () => Promise<T>, undo: () => Promise<void>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    await undo().catch((rollbackErr) => {
      console.error('[photos:keyPhoto] rollback failed', rollbackErr);
    });
    throw isConflict(err) ? new KeyPhotoConflictError() : err;
  }
}

export interface ApplyKeyPhotoInput {
  /** The still's photo record. */
  photo: PhotoResponse;
  still: KeyPhotoFile;
  clip: KeyPhotoFile;
  /** The clip's own photo record, when it has one: its `stillImageTime` follows too. */
  clipPhotoId?: string | null;
  frame: KeyPhotoFrame;
  /** The key-frame time read from the clip before any change, or null. */
  originalStillImageTime: number | null;
}

export interface ApplyKeyPhotoResult {
  /** False when the clip's layout was not one the writer recognises; the still was replaced anyway. */
  clipRewritten: boolean;
  keyPhoto: KeyPhotoRecord;
}

export async function applyKeyPhoto(input: ApplyKeyPhotoInput, deps: KeyPhotoDeps): Promise<ApplyKeyPhotoResult> {
  const { photo, still, clip, frame } = input;
  const existing = keyPhotoOf(photo);

  const [stillDek, clipDek] = await Promise.all([deps.fileKey(still.fileId), deps.fileKey(clip.fileId)]);
  const [stillBefore, clipBefore] = await Promise.all([assertCurrent(deps, still), assertCurrent(deps, clip)]);
  const [stillThumb, clipThumb] = await Promise.all([
    deps.currentThumbnail(stillBefore.coverThumbnailUrl).catch(() => null),
    deps.currentThumbnail(clipBefore.coverThumbnailUrl).catch(() => null),
  ]);

  const rewrittenClip = rewriteStillImageTime(clip.plain, frame.seconds);

  // 1. Snapshots, so the history holds what is about to be replaced.
  const stillVersion = await deps.saveVersion(
    still.fileId,
    still.plain,
    stillDek,
    existing ? KEY_PHOTO_LABEL : ORIGINAL_KEY_PHOTO_LABEL,
  );
  const clipVersion = rewrittenClip
    ? await deps.saveVersion(
        clip.fileId,
        clip.plain,
        clipDek,
        existing?.clipOriginalVersionId ? KEY_PHOTO_LABEL : ORIGINAL_KEY_PHOTO_LABEL,
      )
    : null;
  // A named snapshot bumps the content version; the writes below are guarded by the new one.
  const stillVersionNow = (await deps.fileState(still.fileId)).contentVersion;
  const clipVersionNow = rewrittenClip ? (await deps.fileState(clip.fileId)).contentVersion : clip.contentVersion;

  // 2. The clip.
  let clipWritten: { contentVersion: number } | null = null;
  if (rewrittenClip) {
    clipWritten = await withRollback(
      () => deps.replace(clip.fileId, rewrittenClip, clipDek, { name: clip.name, thumbnailB64: frame.thumbnailB64 }, clipVersionNow),
      async () => {},
    );
  }
  const restoreClip = async () => {
    if (!clipWritten) return;
    await deps.replace(clip.fileId, clip.plain, clipDek, { name: clip.name, thumbnailB64: clipThumb }, clipWritten.contentVersion);
  };

  // 3. The still.
  const stillWritten = await withRollback(
    () =>
      deps.replace(
        still.fileId,
        frame.jpeg,
        stillDek,
        { name: keyPhotoFileName(still.name), mimeType: 'image/jpeg', thumbnailB64: frame.thumbnailB64 },
        stillVersionNow,
      ),
    restoreClip,
  );
  const restoreStill = async () => {
    await deps.replace(
      still.fileId,
      still.plain,
      stillDek,
      { name: still.name, mimeType: still.mimeType, thumbnailB64: stillThumb },
      stillWritten.contentVersion,
    );
  };

  // 4. The record. Originals are kept from the first change: a second change
  //    must still be able to go back to the photo as it was taken.
  const keyPhoto: KeyPhotoRecord = {
    originalVersionId: existing?.originalVersionId ?? stillVersion.id,
    originalName: existing?.originalName ?? still.name,
    originalMimeType: existing?.originalMimeType ?? still.mimeType,
    clipOriginalVersionId: existing?.clipOriginalVersionId ?? clipVersion?.id ?? null,
    originalStillImageTime: existing ? existing.originalStillImageTime : input.originalStillImageTime,
    clipRewritten: (existing?.clipRewritten ?? false) || rewrittenClip !== null,
    frameSeconds: frame.seconds,
    changedAt: new Date().toISOString(),
    ...(existing
      ? pick(existing, ['originalWidth', 'originalHeight'])
      : pick({ originalWidth: photo.metadata?.width, originalHeight: photo.metadata?.height }, ['originalWidth', 'originalHeight'])),
  };
  await withRollback(
    () =>
      deps.mergePhotoMetadata(photo.id, {
        motionPhoto: { stillImageTime: frame.seconds },
        keyPhoto,
        width: frame.width,
        height: frame.height,
      }),
    async () => {
      await restoreStill();
      await restoreClip();
    },
  );

  // 5. Best effort from here: the change itself has landed.
  if (input.clipPhotoId && rewrittenClip) {
    await deps.mergePhotoMetadata(input.clipPhotoId, { motionPhoto: { stillImageTime: frame.seconds } }).catch(() => {});
  }
  await deps.resetDerivedData?.(photo.id).catch(() => {});

  return { clipRewritten: rewrittenClip !== null, keyPhoto };
}

function pick<T extends object>(source: T, keys: Array<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (typeof source[k] === 'number') out[k] = source[k];
  return out;
}

export interface RevertKeyPhotoInput {
  photo: PhotoResponse;
  still: KeyPhotoFile;
  /** Required when the record says the clip was rewritten. */
  clip: KeyPhotoFile | null;
  clipPhotoId?: string | null;
}

export async function revertKeyPhoto(input: RevertKeyPhotoInput, deps: KeyPhotoDeps): Promise<void> {
  const { photo, still, clip } = input;
  const record = keyPhotoOf(photo);
  if (!record) throw new Error('This photo’s key photo has not been changed.');
  const clipToRestore = record.clipRewritten && record.clipOriginalVersionId ? clip : null;
  if (record.clipRewritten && !clipToRestore) throw new Error('The motion clip for this photo could not be found.');

  const stillDek = await deps.fileKey(still.fileId);
  const clipDek = clipToRestore ? await deps.fileKey(clipToRestore.fileId) : null;
  const stillBefore = await assertCurrent(deps, still);
  const clipBefore = clipToRestore ? await assertCurrent(deps, clipToRestore) : null;
  const [stillThumbNow, clipThumbNow] = await Promise.all([
    deps.currentThumbnail(stillBefore.coverThumbnailUrl).catch(() => null),
    clipBefore ? deps.currentThumbnail(clipBefore.coverThumbnailUrl).catch(() => null) : Promise.resolve(null),
  ]);

  const originalStill = await deps.versionBytes(still.fileId, record.originalVersionId, stillDek);
  const originalClip =
    clipToRestore && clipDek ? await deps.versionBytes(clipToRestore.fileId, record.clipOriginalVersionId!, clipDek) : null;
  const [stillThumb, clipThumb] = await Promise.all([
    deps.imageThumbnail(originalStill, record.originalMimeType).catch(() => null),
    originalClip ? deps.clipThumbnail(originalClip, record.originalStillImageTime).catch(() => null) : Promise.resolve(null),
  ]);

  // Clip, then still, then record — the same order as the change.
  let clipWritten: { contentVersion: number } | null = null;
  if (clipToRestore && clipDek && originalClip) {
    clipWritten = await withRollback(
      () => deps.replace(clipToRestore.fileId, originalClip, clipDek, { name: clipToRestore.name, thumbnailB64: clipThumb }, clipToRestore.contentVersion),
      async () => {},
    );
  }
  const restoreClip = async () => {
    if (!clipWritten || !clipToRestore || !clipDek) return;
    await deps.replace(clipToRestore.fileId, clipToRestore.plain, clipDek, { name: clipToRestore.name, thumbnailB64: clipThumbNow }, clipWritten.contentVersion);
  };

  const stillWritten = await withRollback(
    () =>
      deps.replace(
        still.fileId,
        originalStill,
        stillDek,
        { name: record.originalName, mimeType: record.originalMimeType, thumbnailB64: stillThumb },
        still.contentVersion,
      ),
    restoreClip,
  );

  await withRollback(
    () =>
      deps.mergePhotoMetadata(photo.id, {
        motionPhoto: { stillImageTime: record.originalStillImageTime },
        keyPhoto: null,
        ...(record.originalWidth !== undefined ? { width: record.originalWidth } : {}),
        ...(record.originalHeight !== undefined ? { height: record.originalHeight } : {}),
      }),
    async () => {
      await deps.replace(
        still.fileId,
        still.plain,
        stillDek,
        { name: still.name, mimeType: still.mimeType, thumbnailB64: stillThumbNow },
        stillWritten.contentVersion,
      );
      await restoreClip();
    },
  );

  if (input.clipPhotoId && clipWritten) {
    await deps.mergePhotoMetadata(input.clipPhotoId, { motionPhoto: { stillImageTime: record.originalStillImageTime } }).catch(() => {});
  }
  await deps.resetDerivedData?.(photo.id).catch(() => {});
}
