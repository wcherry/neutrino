/**
 * The app's side of changing a Live Photo's key photo (issue #317): loading the
 * two files, wiring `@neutrino/api-photos`' `applyKeyPhoto`/`revertKeyPhoto` to
 * the network, and the thumbnails only a page can draw. The scrubber dialog and
 * the editor's **Key Photo** tool both come through here, so neither writes
 * anything of its own.
 */

import { photosApi, readMotionPhotoInfo, type PhotoResponse } from '@neutrino/api-photos';
import {
  applyKeyPhoto,
  createKeyPhotoDeps,
  revertKeyPhoto,
  type ApplyKeyPhotoResult,
  type KeyPhotoDeps,
  type KeyPhotoFile,
} from '@neutrino/api-photos/key-photo';
import { storageApi } from '@neutrino/api-drive';
import { generateThumbnail, generateVideoThumbnail } from '@neutrino/utils';
import { loadPlainBlob } from '@/lib/plainFileBlob';
import { toRenderableImageBlob } from '@/lib/heic';
import { keyPhotoFrame } from '@/lib/livePhotos/keyFrame';
import type { KeyPhotoTarget } from './useKeyPhotoTarget';

export interface KeyPhotoFiles {
  still: KeyPhotoFile;
  clip: KeyPhotoFile;
  /** The clip's key-frame time as it stands, or null when the clip does not say. */
  currentStillImageTime: number | null;
}

async function loadFile(fileId: string, userId: string, mimeFallback: string): Promise<KeyPhotoFile> {
  // Permission-checked, unlike `/metadata`, so an editor of a shared photo can do this too.
  const [meta, blob] = await Promise.all([storageApi.getFileInfo(fileId), loadPlainBlob(fileId, userId, true)]);
  return {
    fileId,
    name: meta.name,
    mimeType: meta.mimeType || mimeFallback,
    contentVersion: meta.contentVersion,
    plain: new Uint8Array(await blob.arrayBuffer()),
  };
}

/** Both files, decrypted, with the content versions any write will be guarded by. */
export async function loadKeyPhotoFiles(target: KeyPhotoTarget, userId: string): Promise<KeyPhotoFiles> {
  const [still, clip] = await Promise.all([
    loadFile(target.stillFileId, userId, 'image/heic'),
    loadFile(target.clipFileId, userId, 'video/quicktime'),
  ]);
  const info = await readMotionPhotoInfo(new Blob([clip.plain.slice().buffer as ArrayBuffer], { type: 'video/quicktime' }), {
    fileName: clip.name,
    mimeType: 'video/quicktime',
  }).catch(() => null);
  return { still, clip, currentStillImageTime: info?.stillImageTime ?? null };
}

function depsFor(userId: string): KeyPhotoDeps {
  return createKeyPhotoDeps({
    userId,
    async imageThumbnail(plain, mimeType) {
      // A HEIC original only decodes natively in Safari; transcode first.
      const renderable = await toRenderableImageBlob(new Blob([plain.slice().buffer as ArrayBuffer], { type: mimeType }));
      return generateThumbnail(new File([renderable], 'still', { type: renderable.type || 'image/png' }));
    },
    clipThumbnail: (plain, atSeconds) =>
      generateVideoThumbnail(new Blob([plain.slice().buffer as ArrayBuffer], { type: 'video/quicktime' }), {
        atSeconds: atSeconds ?? undefined,
      }),
  });
}

/** The still's record, registering a Drive-only still so the change has somewhere to be recorded. */
async function stillRecord(target: KeyPhotoTarget): Promise<PhotoResponse> {
  if (target.photo) return (await photosApi.listPhotosByFiles([target.stillFileId]))[0] ?? target.photo;
  return photosApi.registerPhoto({ fileId: target.stillFileId });
}

export interface ChosenImage {
  /** JPEG bytes: a captured frame, or the editor's export of it. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface KeyPhotoChangeOutcome extends ApplyKeyPhotoResult {
  /** False when the original still had no EXIF to carry across. */
  exifCopied: boolean;
}

export async function changeKeyPhoto(
  target: KeyPhotoTarget,
  userId: string,
  image: ChosenImage,
  seconds: number,
  files?: KeyPhotoFiles,
): Promise<KeyPhotoChangeOutcome> {
  const loaded = files ?? (await loadKeyPhotoFiles(target, userId));
  const photo = await stillRecord(target);
  const { frame, exifCopied } = await keyPhotoFrame(image, seconds, loaded.still.plain);
  const result = await applyKeyPhoto(
    {
      photo,
      still: loaded.still,
      clip: loaded.clip,
      clipPhotoId: target.clipPhotoId,
      frame,
      originalStillImageTime: loaded.currentStillImageTime,
    },
    depsFor(userId),
  );
  return { ...result, exifCopied };
}

export async function revertToOriginalKeyPhoto(target: KeyPhotoTarget, userId: string, files?: KeyPhotoFiles): Promise<void> {
  const loaded = files ?? (await loadKeyPhotoFiles(target, userId));
  const photo = await stillRecord(target);
  await revertKeyPhoto({ photo, still: loaded.still, clip: loaded.clip, clipPhotoId: target.clipPhotoId }, depsFor(userId));
}

/** What the user is told when the clip could not be updated. */
export const CLIP_NOT_UPDATED_WARNING =
  'The motion clip couldn’t be updated, so this photo’s motion may end on the previous frame on an iPhone.';
