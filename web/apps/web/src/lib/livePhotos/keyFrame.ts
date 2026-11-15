/**
 * Frames out of a Live Photo's clip, for choosing its key photo (issue #317).
 *
 * The DOM half of the feature; `@neutrino/api-photos`' `keyPhoto.ts` is the
 * half that writes. Browsers expose no frame rate, so stepping frame by frame is
 * done against `requestVideoFrameCallback`'s `mediaTime` — the presentation
 * time of the frame actually on screen — with 1/30 s as the fallback where it
 * is missing (Firefox before 130).
 *
 * **Rotation.** An iPhone stores a portrait clip landscape with a rotation in
 * its track header. `videoWidth`/`videoHeight` report the displayed (rotated)
 * size and `drawImage` paints the frame upright in Chrome, Safari and Firefox,
 * which is what lets the captured JPEG carry `Orientation` = 1. That is a
 * property of each browser and has not been checked here against real iPhone
 * portrait clips yet (the issue's fixture test); `captureFrame` reports the size
 * it drew so a sideways result would at least be visible in the resolution
 * shown beside the button.
 */

import { copyExifToJpeg, type KeyPhotoFrame } from '@neutrino/api-photos/key-photo';
import { generateThumbnail } from '@neutrino/utils';

export const FALLBACK_FRAME_SECONDS = 1 / 30;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

/** Resolve once `video` has painted a frame, with that frame's media time when the browser says. */
function nextPaintedFrame(video: HTMLVideoElement): Promise<number | null> {
  const v = video as VideoWithFrameCallback;
  if (typeof v.requestVideoFrameCallback !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    v.requestVideoFrameCallback!((_now, meta) => finish(meta.mediaTime));
    // A paused video at the same position paints nothing new; don't wait for ever.
    setTimeout(() => finish(null), 250);
  });
}

/** Seek and wait for the frame to be on screen. Answers the frame's media time, or the requested time. */
export async function seekTo(video: HTMLVideoElement, seconds: number): Promise<number> {
  const duration = Number.isFinite(video.duration) ? video.duration : seconds;
  const target = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.001));
  if (Math.abs(video.currentTime - target) > 1e-6) {
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = target;
    });
  }
  const painted = await nextPaintedFrame(video);
  return painted ?? target;
}

/**
 * The clip's frame duration, measured by playing a few frames silently and
 * taking the smallest step between presented media times.
 */
export async function measureFrameDuration(video: HTMLVideoElement): Promise<number> {
  const v = video as VideoWithFrameCallback;
  if (typeof v.requestVideoFrameCallback !== 'function') return FALLBACK_FRAME_SECONDS;
  const times: number[] = [];
  const wasMuted = video.muted;
  video.muted = true;
  try {
    await new Promise<void>((resolve) => {
      const tick = (_now: number, meta: { mediaTime: number }) => {
        times.push(meta.mediaTime);
        if (times.length >= 6) resolve();
        else v.requestVideoFrameCallback!(tick);
      };
      v.requestVideoFrameCallback!(tick);
      void video.play().catch(() => resolve());
      setTimeout(resolve, 600);
    });
  } finally {
    video.pause();
    video.muted = wasMuted;
  }
  const steps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((d) => d > 0.001);
  return steps.length > 0 ? Math.min(...steps) : FALLBACK_FRAME_SECONDS;
}

/** The frame on screen, as a JPEG at the video's full displayed size. */
export async function captureFrame(video: HTMLVideoElement, quality = 0.92): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The clip has no frame to capture.');
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the frame.');
    ctx.drawImage(video, 0, 0, width, height);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the frame.');
    ctx.drawImage(video, 0, 0, width, height);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
    );
  }
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** A small base64 JPEG of `jpeg`, for the Drive thumbnails. */
export async function thumbnailOf(jpeg: Uint8Array): Promise<string | null> {
  return generateThumbnail(new File([jpeg.slice().buffer as ArrayBuffer], 'frame.jpg', { type: 'image/jpeg' }));
}

/**
 * The key photo as `applyKeyPhoto` wants it: `jpeg` (a captured frame, or the
 * editor's export) carrying the original still's EXIF, plus its thumbnail.
 */
export async function keyPhotoFrame(
  image: { jpeg: Uint8Array; width: number; height: number },
  seconds: number,
  originalStill: Uint8Array,
): Promise<{ frame: KeyPhotoFrame; exifCopied: boolean }> {
  const { bytes, copied } = copyExifToJpeg(originalStill, image.jpeg, { width: image.width, height: image.height });
  return {
    frame: { jpeg: bytes, width: image.width, height: image.height, seconds, thumbnailB64: await thumbnailOf(image.jpeg) },
    exifCopied: copied,
  };
}

/** About `count` small frames spread across the clip, drawn from an off-screen copy of it. */
export async function filmstrip(src: string, count = 12, height = 56): Promise<Array<{ seconds: number; url: string }>> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('The clip could not be decoded.'));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const frames: Array<{ seconds: number; url: string }> = [];
  for (let i = 0; i < count && ctx; i++) {
    const seconds = count === 1 ? 0 : (duration * i) / (count - 1);
    await seekTo(video, seconds);
    ctx.drawImage(video, 0, 0, width, height);
    frames.push({ seconds, url: canvas.toDataURL('image/jpeg', 0.6) });
  }
  video.removeAttribute('src');
  video.load();
  return frames;
}

/** "1.6 MP", to one decimal place under 10. */
export function megapixels(width: number, height: number): string {
  const mp = (width * height) / 1_000_000;
  return `${mp < 10 ? mp.toFixed(1) : Math.round(mp)} MP`;
}
