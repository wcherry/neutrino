import { initSodium, loadKeyPair } from '@neutrino/e2e-crypto';
import { storageApi, authApi, downloadAndDecryptFile, type FileItem } from '@/lib/api';
import { toRenderableImageBlob } from '@/lib/heic';

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface MediaDimensions {
  width: number;
  height: number;
  orientation: Orientation;
}

/** Past these the info panel would download more than it is worth for two numbers. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export function orientationOf(width: number, height: number): Orientation {
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

/** Whether the file is an image or a video the panel can measure, and the file is not too big to fetch. */
export function mediaKindOf(file: Pick<FileItem, 'mimeType' | 'sizeBytes'>): 'image' | 'video' | null {
  if (file.mimeType.startsWith('image/') && file.sizeBytes <= MAX_IMAGE_BYTES) return 'image';
  if (file.mimeType.startsWith('video/') && file.sizeBytes <= MAX_VIDEO_BYTES) return 'video';
  return null;
}

/**
 * Measure a decoded picture or movie. Sizes are as displayed: browsers apply
 * an image's EXIF rotation before reporting `naturalWidth`/`naturalHeight`, so
 * a portrait phone photo stored sideways reads as portrait here.
 */
export function measureMedia(blob: Blob, kind: 'image' | 'video'): Promise<MediaDimensions> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const done = (width: number, height: number) => {
      URL.revokeObjectURL(url);
      if (!width || !height) reject(new Error('no dimensions'));
      else resolve({ width, height, orientation: orientationOf(width, height) });
    };
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not decode media'));
    };
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = fail;
      img.src = url;
    } else {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => done(video.videoWidth, video.videoHeight);
      video.onerror = fail;
      video.src = url;
    }
  });
}

/** Download (decrypting if need be) and measure a Drive file. */
export async function loadMediaDimensions(file: FileItem, userId: string | undefined): Promise<MediaDimensions> {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error('not measurable');
  let blob: Blob;
  if (file.encryptedMetadata) {
    const id = (userId ?? await authApi.getProfile().then((u) => u.id))!;
    await initSodium();
    if (!loadKeyPair(id)) throw new Error('No local keypair — cannot decrypt file');
    const bytes = await downloadAndDecryptFile(file.id, id);
    if (!bytes) throw new Error('Failed to decrypt file');
    blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.mimeType });
  } else {
    blob = await storageApi.fetchPreviewBlob(file.id);
  }
  // HEIC is not decodable outside Safari; the same transcode the preview uses.
  if (kind === 'image') blob = await toRenderableImageBlob(blob);
  return measureMedia(blob, kind);
}
