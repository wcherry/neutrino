/**
 * The production `KeyPhotoDeps`: Drive and Photos over the network, encrypted
 * with each file's own key. Kept apart from `keyPhoto.ts` so the sequence there
 * is tested against fakes and this file is the only place that talks to the
 * server for it.
 *
 * Thumbnails are the caller's, because drawing one needs the DOM (and, for a
 * HEIC original on revert, the app's transcoder).
 */

import { request } from '@neutrino/api-core';
import {
  driveCreateEncryptedVersionBytes,
  driveDownloadVersionBytes,
  driveReplaceEncryptedBytes,
  requireFileKey,
  storageApi,
} from '@neutrino/api-drive';
import type { KeyPhotoDeps } from './keyPhoto';
import type { ListFacesResponse } from './index';

export interface KeyPhotoDepsOptions {
  userId: string;
  imageThumbnail: KeyPhotoDeps['imageThumbnail'];
  clipThumbnail: KeyPhotoDeps['clipThumbnail'];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function createKeyPhotoDeps({ userId, imageThumbnail, clipThumbnail }: KeyPhotoDepsOptions): KeyPhotoDeps {
  return {
    async fileKey(fileId) {
      const { dek, isNew } = await requireFileKey(userId, fileId);
      // A freshly minted key would mean the stored bytes were plaintext all
      // along; this flow only ever handles encrypted photos.
      if (isNew) throw new Error('This photo is not encrypted with a key this session holds.');
      return dek;
    },
    async fileState(fileId) {
      // `/info` is permission-checked; `/metadata` answers only the owner.
      const file = await storageApi.getFileInfo(fileId);
      return { contentVersion: file.contentVersion, coverThumbnailUrl: file.coverThumbnailUrl };
    },
    async saveVersion(fileId, plain, dek, label) {
      const version = await driveCreateEncryptedVersionBytes(fileId, plain, 'blob', dek, label);
      return { id: version.id };
    },
    async replace(fileId, plain, dek, extras, expectedContentVersion) {
      const file = await driveReplaceEncryptedBytes(fileId, plain, dek, extras, { expectedContentVersion });
      return { contentVersion: file.contentVersion };
    },
    async versionBytes(fileId, versionId, dek) {
      const { initSodium, decryptFile } = await import('@neutrino/e2e-crypto');
      await initSodium();
      return decryptFile(await driveDownloadVersionBytes(fileId, versionId), dek);
    },
    async currentThumbnail(coverThumbnailUrl) {
      const url = storageApi.getThumbnailUrl(coverThumbnailUrl);
      if (!url) return null;
      const res = await fetch(url, { credentials: 'include' });
      return res.ok ? blobToBase64(await res.blob()) : null;
    },
    mergePhotoMetadata: (photoId, patch) =>
      request(`/api/v1/photos/${photoId}/metadata`, { method: 'PATCH', body: JSON.stringify(patch) }),
    imageThumbnail,
    clipThumbnail,
    async resetDerivedData(photoId) {
      // Face boxes were found on the old pixels. Drop them and ask again.
      const { faces } = await request<ListFacesResponse>(`/api/v1/photos/${photoId}/faces`);
      for (const face of faces) {
        await request(`/api/v1/photos/${photoId}/faces/${face.id}`, { method: 'DELETE' });
      }
      await request(`/api/v1/photos/${photoId}/faces/detect`, { method: 'POST' });
    },
  };
}
