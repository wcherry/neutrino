/**
 * `@neutrino/api-photos/key-photo` — changing a Live Photo's key photo (issue #317).
 *
 * A subpath of its own rather than part of the package's main export because
 * that barrel reaches every route through `@/lib/api`, and only the photo
 * editor and the key-photo dialog need any of this. Keep it out of `index.ts`.
 */

export { readStillImageTimeTrack, rewriteStillImageTime, STILL_IMAGE_TIME_TRACK_KEY } from './quicktime';
export { extractExifTiff, patchExifTiff, insertExifIntoJpeg, copyExifToJpeg, type ExifPatch, type ExifCopyResult } from './exif';
export {
  applyKeyPhoto,
  revertKeyPhoto,
  keyPhotoOf,
  keyPhotoFileName,
  KeyPhotoConflictError,
  ORIGINAL_KEY_PHOTO_LABEL,
  KEY_PHOTO_LABEL,
  type KeyPhotoRecord,
  type KeyPhotoDeps,
  type KeyPhotoFile,
  type KeyPhotoFrame,
  type ApplyKeyPhotoInput,
  type ApplyKeyPhotoResult,
  type RevertKeyPhotoInput,
} from './keyPhoto';
export { createKeyPhotoDeps, type KeyPhotoDepsOptions } from './keyPhotoDeps';
