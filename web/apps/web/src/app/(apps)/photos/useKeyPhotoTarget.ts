'use client';

/**
 * Whether a photo can have its key photo chosen, and the two files it takes
 * (issue #317).
 *
 * **Choose Key Photo** is for an Apple Live Photo whose clip is a separate file
 * the user may edit, and nothing else. A Google Motion Photo keeps its clip
 * inside the JPEG's own bytes, so replacing the still would mean re-appending
 * the clip and rewriting XMP offsets — not done here, so it is not offered.
 *
 * The clip is found the way Drive finds it (`lib/livePhotos/`): the still
 * record's `device.liveVideoFileID`, then a same-folder video with the same
 * stem. Edit rights come from `GET /files/{id}/info`, which is
 * permission-checked — a photo shared for viewing does not offer the action.
 */

import { useQuery } from '@tanstack/react-query';
import { photosApi, motionPhotoOf, type PhotoResponse } from '@neutrino/api-photos';
// Type only: this hook loads with the library and the editor, the key-photo code does not.
import type { KeyPhotoRecord } from '@neutrino/api-photos/key-photo';
import { filesystemApi, storageApi } from '@neutrino/api-drive';
import { useUser } from '@neutrino/auth';
import { resolvePreviewClip } from '@/lib/livePhotos/resolvePreviewClip';

export interface KeyPhotoTarget {
  stillFileId: string;
  /** The still's photo record; null when it is in Drive but not yet registered. */
  photo: PhotoResponse | null;
  clipFileId: string;
  /** The clip's photo record id, when it has one. */
  clipPhotoId: string | null;
  keyPhoto: KeyPhotoRecord | null;
}

const EDIT_ROLES = new Set(['owner', 'editor']);

/** The record's `keyPhoto`, read here rather than imported (see the import above). */
function keyPhotoOf(photo: PhotoResponse | null): KeyPhotoRecord | null {
  const value = photo?.metadata?.keyPhoto;
  return value && typeof value.originalVersionId === 'string' ? value : null;
}

export async function resolveKeyPhotoTarget(stillFileId: string, rootFolderId: string | null): Promise<KeyPhotoTarget | null> {
  // `/info` rather than `/metadata`: it is permission-checked, so an editor of
  // a shared photo gets an answer, and it carries the caller's role.
  const info = await storageApi.getFileInfo(stillFileId);
  if (!EDIT_ROLES.has(info.yourRole)) return null;
  const still = {
    id: info.id,
    name: info.name,
    mimeType: info.mimeType ?? '',
    folderId: info.folderId,
    sizeBytes: info.sizeBytes,
  };

  const [record] = await photosApi.listPhotosByFiles([stillFileId]).catch(() => [] as PhotoResponse[]);
  const photo = record ?? null;
  if (photo && motionPhotoOf(photo)?.subtype === 'motion_photo_google') return null;

  const clip = await resolvePreviewClip(
    // No bytes: an embedded (Google) clip is exactly what this does not take.
    { still, stillBlob: new Blob([]), rootFolderId },
    {
      listPhotosByFiles: async () => (photo ? [photo] : []),
      getFolderContents: (folderId, query) => filesystemApi.getFolderContents(folderId, query),
      readMotionPhotoInfo: async () => null,
    },
  );
  if (!clip || clip.kind !== 'file' || clip.subtype !== 'live_photo_apple') return null;

  const [clipInfo, clipRecords] = await Promise.all([
    storageApi.getFileInfo(clip.fileId).catch(() => null),
    photosApi.listPhotosByFiles([clip.fileId]).catch(() => [] as PhotoResponse[]),
  ]);
  if (!clipInfo || !EDIT_ROLES.has(clipInfo.yourRole)) return null;
  const clipRecord = clipRecords[0] ?? null;
  if (clipRecord && motionPhotoOf(clipRecord)?.subtype === 'motion_photo_google') return null;

  return {
    stillFileId,
    photo,
    clipFileId: clip.fileId,
    clipPhotoId: clipRecord?.id ?? null,
    keyPhoto: keyPhotoOf(photo),
  };
}

/** The key-photo target for `stillFileId`, or null when the action does not apply. */
export function useKeyPhotoTarget(stillFileId: string | null | undefined) {
  const user = useUser();
  return useQuery({
    queryKey: ['photos-key-photo-target', stillFileId],
    queryFn: () => resolveKeyPhotoTarget(stillFileId!, user?.id ?? null),
    enabled: !!stillFileId && !!user?.id,
    staleTime: 60_000,
    retry: false,
  });
}
