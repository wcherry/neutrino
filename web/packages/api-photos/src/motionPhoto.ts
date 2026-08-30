/**
 * Motion photos — Apple Live Photos and Google Motion Photos.
 *
 * Both are "a picture that moves", and both arrive looking like something else.
 * Apple splits one into two files, a still (`IMG_1234.HEIC`) and a ~3 second
 * clip (`IMG_1234.MOV`), so the clip lands in the library as a silent movie
 * beside its own picture (issue #154). Google packs one into a *single* file —
 * a JPEG with an MP4 appended — or exports it as a bare `.mp4`, so it lands as
 * a movie with no picture at all (issue #156). This module is the whole model
 * of "this is a photo, and it moves": classification at upload time, and
 * pairing at display time.
 *
 * **Classification reads embedded metadata, never the extension.** Apple stamps
 * its clip with `com.apple.quicktime.content.identifier`, the UUID tying it to
 * the still it was captured with. Google writes XMP — `GCamera:MotionPhoto` or
 * the older `GCamera:MicroVideo` — into the JPEG's APP1 segment or the movie's
 * `uuid`/`udta` box. An ordinary video carries neither, which is what keeps
 * ordinary videos out of the photo grid. All of it has to be read in the
 * browser: photo content is E2EE, so the server holds ciphertext and
 * `exiftool` server-side would have nothing to look at.
 *
 * **Pairing cannot rely on the identifier alone.** The still's copy of it is
 * buried in an Apple MakerNote we do not parse, the main library listing is
 * served by the generic Drive endpoint (which carries no photo metadata at
 * all), and anything uploaded before this shipped has no metadata either. So
 * pairing matches on the identifier when both halves carry it and falls back to
 * the filename stem, which is what Apple and Google Takeout both name the two
 * halves with. Metadata is the more reliable signal — hence the order — but the
 * stem is what makes an existing library work.
 */

import type { PhotoResponse } from './index';
import { readQuickTimeBoxes } from './quicktime';
import { readGCameraMotion, readJpegXmp } from './xmp';

/** Apple's key for the UUID shared by a Live Photo's still and its movie. */
export const CONTENT_IDENTIFIER_KEY = 'com.apple.quicktime.content.identifier';
/** Apple's key marking which instant in the movie is the still frame. */
export const STILL_IMAGE_TIME_KEY = 'com.apple.quicktime.still-image-time';

/**
 * Which flavour of motion photo this is. Recorded on the photo so a support
 * case can tell why an asset was classified the way it was, and so the UI can
 * name it the way its own platform does.
 */
export type MotionPhotoSubtype = 'live_photo_apple' | 'motion_photo_google';

/** Where a self-contained motion photo keeps its clip inside its own bytes. */
export interface EmbeddedVideo {
  /** Byte offset of the MP4 within the file. */
  offset: number;
  /** Its length in bytes. */
  length: number;
}

export interface MotionPhotoInfo {
  subtype: MotionPhotoSubtype;
  /**
   * The metadata field that classified this file. Carried through to the import
   * log and stored on the photo, so "why is this a photo?" has an answer.
   */
  signal: string;
  /** Apple: the UUID linking a clip to the still it was captured with. */
  contentIdentifier?: string;
  /** Apple: seconds into the clip that the still frame sits at. */
  stillImageTime?: number;
  /** Google: microseconds into the clip that the still frame sits at. */
  presentationTimestampUs?: number;
  /** Google: the clip appended to this file's own bytes, when there is one. */
  embedded?: EmbeddedVideo;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Does this movie's metadata mark it as the motion half of an Apple Live Photo?
 *
 * The content identifier is the clue: it links the movie to the still it was
 * captured with, and an ordinary video has no reason to carry one. The three
 * spellings are the same field as written by QuickTime itself, by ExifTool's
 * grouped output, and by its human-readable output.
 */
export function isLikelyLivePhotoMov(metadata: Record<string, unknown>): boolean {
  return Boolean(
    metadata[CONTENT_IDENTIFIER_KEY] ||
      metadata['quicktime:ContentIdentifier'] ||
      metadata['ContentIdentifier'] ||
      metadata['Content Identifier'],
  );
}

function appleInfoFrom(metadata: Record<string, string | number>): MotionPhotoInfo | null {
  if (!isLikelyLivePhotoMov(metadata)) return null;
  const raw =
    metadata[CONTENT_IDENTIFIER_KEY] ??
    metadata['quicktime:ContentIdentifier'] ??
    metadata['ContentIdentifier'] ??
    metadata['Content Identifier'];
  const contentIdentifier = String(raw).trim();
  if (!contentIdentifier) return null;

  const stillTime = metadata[STILL_IMAGE_TIME_KEY];
  return {
    subtype: 'live_photo_apple',
    signal: CONTENT_IDENTIFIER_KEY,
    contentIdentifier,
    // Apple writes -1 here when the still frame is marked by a timed-metadata
    // track instead, which we do not read; only keep a usable offset.
    ...(typeof stillTime === 'number' && Number.isFinite(stillTime) && stillTime >= 0
      ? { stillImageTime: stillTime }
      : {}),
  };
}

/** Bytes at `offset` that begin an ISO-BMFF box — `....ftyp`. */
function startsWithFtyp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/**
 * Locate the MP4 appended to a Google Motion Photo's JPEG.
 *
 * XMP states the clip's length, and the clip is last in the file, so the offset
 * follows — but writers disagree about whether padding counts and some files
 * have been re-saved since. The claim is therefore verified against the `ftyp`
 * box that has to be there, and a failed check falls back to scanning the tail
 * for it. Returning null means the still is all we have, which is a photo
 * without motion rather than a failure.
 */
async function locateEmbeddedVideo(
  source: Blob,
  lengthFromEnd: number | undefined,
): Promise<EmbeddedVideo | null> {
  const check = async (offset: number): Promise<EmbeddedVideo | null> => {
    if (offset <= 0 || offset >= source.size) return null;
    const head = new Uint8Array(await source.slice(offset, offset + 8).arrayBuffer());
    return startsWithFtyp(head) ? { offset, length: source.size - offset } : null;
  };

  if (lengthFromEnd !== undefined) {
    const claimed = await check(source.size - lengthFromEnd);
    if (claimed) return claimed;
  }

  // The clip is at the tail, so search back from the end rather than forward
  // through the image data. 8 MB comfortably covers a three-second clip.
  const scanBytes = Math.min(source.size, 8 * 1024 * 1024);
  const start = source.size - scanBytes;
  const tail = new Uint8Array(await source.slice(start).arrayBuffer());
  for (let i = 0; i + 8 <= tail.length; i++) {
    if (
      tail[i + 4] === 0x66 &&
      tail[i + 5] === 0x74 &&
      tail[i + 6] === 0x79 &&
      tail[i + 7] === 0x70
    ) {
      const offset = start + i;
      // The four bytes before `ftyp` are the box size; a sane one confirms it.
      const size =
        (tail[i] << 24) | (tail[i + 1] << 16) | (tail[i + 2] << 8) | tail[i + 3];
      if (size >= 8 && size <= source.size - offset) {
        return { offset, length: source.size - offset };
      }
    }
  }
  return null;
}

function looksLikeMovie(fileName: string, mimeType: string): boolean {
  return (
    mimeType === 'video/quicktime' ||
    mimeType === 'video/mp4' ||
    mimeType.startsWith('video/') ||
    /\.(mov|mp4|m4v)$/i.test(fileName)
  );
}

function looksLikeJpeg(fileName: string, mimeType: string): boolean {
  return mimeType === 'image/jpeg' || /\.(jpe?g)$/i.test(fileName);
}

/**
 * Classify one file as an Apple Live Photo, a Google Motion Photo, or neither.
 *
 * A null answer means "an ordinary photo or video, treat it as one" — which is
 * the answer every file without the metadata gets, extension notwithstanding.
 */
export async function readMotionPhotoInfo(
  source: Blob,
  file: { fileName?: string; mimeType?: string } = {},
): Promise<MotionPhotoInfo | null> {
  const fileName = file.fileName ?? (source as File).name ?? '';
  const mimeType = file.mimeType ?? source.type ?? '';

  if (looksLikeMovie(fileName, mimeType)) {
    const { metadata, xmp } = await readQuickTimeBoxes(source);
    // Apple's own metadata is the stronger signal, so it is asked for first.
    const apple = appleInfoFrom(metadata);
    if (apple) return apple;

    const google = xmp ? readGCameraMotion(xmp) : null;
    if (!google) return null;
    return {
      subtype: 'motion_photo_google',
      signal: google.signal,
      ...(google.presentationTimestampUs !== undefined
        ? { presentationTimestampUs: google.presentationTimestampUs }
        : {}),
    };
  }

  if (looksLikeJpeg(fileName, mimeType)) {
    const xmp = await readJpegXmp(source);
    const google = xmp ? readGCameraMotion(xmp) : null;
    if (!google) return null;
    const embedded = await locateEmbeddedVideo(source, google.videoLengthFromEnd);
    return {
      subtype: 'motion_photo_google',
      signal: google.signal,
      ...(google.presentationTimestampUs !== undefined
        ? { presentationTimestampUs: google.presentationTimestampUs }
        : {}),
      ...(embedded ? { embedded } : {}),
    };
  }

  return null;
}

/**
 * Where to seek for a representative frame of this motion photo, in seconds, or
 * undefined when the file does not say and the middle of the clip is as good a
 * guess as any.
 */
export function stillFrameSeconds(info: MotionPhotoInfo): number | undefined {
  if (info.stillImageTime !== undefined) return info.stillImageTime;
  if (info.presentationTimestampUs !== undefined) return info.presentationTimestampUs / 1_000_000;
  return undefined;
}

// ---------------------------------------------------------------------------
// A representative frame
// ---------------------------------------------------------------------------

/**
 * Grab a frame out of a video as a base64 JPEG, in the shape `generateThumbnail`
 * returns for images (raw base64, no data-URL prefix, null on failure).
 *
 * This is what stops a motion photo with no still beside it from sitting in the
 * library as a black tile. Without a hint from the file the middle of the clip
 * is the frame to take: a motion photo records roughly a second either side of
 * the shutter, so the middle is the picture.
 */
export function generateVideoThumbnail(
  file: Blob,
  opts: { atSeconds?: number; maxSize?: number } = {},
): Promise<string | null> {
  const { atSeconds, maxSize = 512 } = opts;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(value);
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    // Without this Chrome refuses to paint a blob-backed video onto a canvas.
    video.crossOrigin = 'anonymous';

    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target =
        atSeconds != null && atSeconds >= 0 && (duration === 0 || atSeconds < duration)
          ? atSeconds
          : duration / 2;
      // A seek to 0 fires no `seeked` event in some browsers — the frame is
      // already decoded, so draw it straight away.
      if (target <= 0) {
        draw();
        return;
      }
      video.onseeked = draw;
      video.currentTime = target;
    };

    const draw = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        finish(null);
        return;
      }
      const scale = Math.min(maxSize / width, maxSize / height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        finish(null);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? null);
      } catch (err) {
        console.warn('[motionPhoto] could not draw video frame:', err);
        finish(null);
      }
    };

    video.onerror = () => {
      console.warn('[motionPhoto] video load failed for', (file as File).name ?? 'blob');
      finish(null);
    };

    video.src = url;
  });
}

// ---------------------------------------------------------------------------
// Pairing a library listing
// ---------------------------------------------------------------------------

/** One tile in the library: a photo, plus whatever motion belongs to it. */
export interface LibraryItem {
  /** The asset the tile shows — the still, whenever there is one. */
  photo: PhotoResponse;
  /** The motion half held in a separate file, as Apple splits it. */
  motion: PhotoResponse | null;
  /** The motion clip inside `photo`'s own bytes, as Google appends it. */
  embedded: EmbeddedVideo | null;
  /** Which flavour of motion photo this is, or null for an ordinary asset. */
  subtype: MotionPhotoSubtype | null;
  /** True when the tile has motion to play, from either source. */
  isMotionPhoto: boolean;
}

function isImage(photo: PhotoResponse): boolean {
  return photo.mimeType.startsWith('image/');
}

function isVideo(photo: PhotoResponse): boolean {
  return photo.mimeType.startsWith('video/');
}

/** What was recorded about this photo at upload time, if anything was. */
export function motionPhotoOf(photo: PhotoResponse): MotionPhotoInfo | null {
  const info = photo.metadata?.motionPhoto;
  return info && typeof info.subtype === 'string' ? info : null;
}

/** The identifier Apple shares between a Live Photo's two halves. */
export function motionContentIdentifier(photo: PhotoResponse): string | null {
  const id = motionPhotoOf(photo)?.contentIdentifier;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The filename both halves of a Live Photo share — `IMG_1234.HEIC` and
 * `IMG_1234.MOV` both reduce to `img_1234`.
 *
 * Google's `.MP` marker is dropped too (`PXL_20230101.MP.jpg`), as is Takeout's
 * copy suffix (`IMG_1234(1).JPG`), which numbers the duplicate rather than the
 * picture.
 */
export function motionPhotoStem(fileName: string): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  const withoutExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const stem = withoutExt
    .replace(/\(\d+\)$/, '')
    .replace(/\.MP$/i, '')
    .trim()
    .toLowerCase();
  return stem.length > 0 ? stem : null;
}

/**
 * Fold a listing's motion clips into the stills they belong to.
 *
 * `items` is the listing as shown: images stay, and a video stays too unless it
 * is claimed as some still's motion half — the archive and favourites tabs list
 * ordinary videos and should keep doing so. `motionCandidates` are files pulled
 * in only to be paired (the main tab's listing carries images alone, so the
 * clips have to be fetched separately); an unclaimed one is dropped unless it is
 * itself a motion photo with no still, which earns its own tile.
 */
export function pairMotionPhotos(
  items: PhotoResponse[],
  motionCandidates: PhotoResponse[] = [],
): LibraryItem[] {
  const listed = new Set(items.map((p) => p.id));
  const candidates = [
    ...items.filter(isVideo),
    ...motionCandidates.filter((p) => isVideo(p) && !listed.has(p.id)),
  ];

  const byIdentifier = new Map<string, PhotoResponse>();
  const byStem = new Map<string, PhotoResponse>();
  for (const still of items.filter(isImage)) {
    const identifier = motionContentIdentifier(still);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, still);
    const stem = motionPhotoStem(still.fileName);
    if (stem && !byStem.has(stem)) byStem.set(stem, still);
  }

  const motionByStill = new Map<string, PhotoResponse>();
  const claimed = new Set<string>();
  for (const clip of candidates) {
    const identifier = motionContentIdentifier(clip);
    const stem = motionPhotoStem(clip.fileName);
    const still =
      (identifier ? byIdentifier.get(identifier) : undefined) ??
      (stem ? byStem.get(stem) : undefined);
    // Metadata beats the filename, so a clip that already matched by identifier
    // is never displaced; the first clip to claim a still keeps it.
    if (!still || motionByStill.has(still.id)) continue;
    motionByStill.set(still.id, clip);
    claimed.add(clip.id);
  }

  const itemFor = (photo: PhotoResponse, motion: PhotoResponse | null): LibraryItem => {
    const own = motionPhotoOf(photo);
    const embedded = own?.embedded ?? null;
    // A still with a separate clip takes that clip's flavour; a self-contained
    // Google file carries its own.
    const subtype = motion ? motionPhotoOf(motion)?.subtype ?? 'live_photo_apple' : own?.subtype ?? null;
    const isMotionPhoto = motion !== null || embedded !== null || own !== null;
    return { photo, motion, embedded, subtype: isMotionPhoto ? subtype : null, isMotionPhoto };
  };

  const result: LibraryItem[] = [];
  for (const item of items) {
    if (isVideo(item) && claimed.has(item.id)) continue;
    result.push(itemFor(item, motionByStill.get(item.id) ?? null));
  }
  for (const clip of candidates) {
    if (claimed.has(clip.id) || listed.has(clip.id)) continue;
    // A motion photo whose still never made it into the library still belongs
    // on screen; an ordinary video pulled in only as a candidate does not.
    if (motionPhotoOf(clip)) result.push(itemFor(clip, null));
  }
  return result;
}

/** What to call this on screen — each platform's own name for the thing. */
export function motionPhotoLabel(subtype: MotionPhotoSubtype | null): string {
  return subtype === 'motion_photo_google' ? 'MOTION' : 'LIVE';
}
