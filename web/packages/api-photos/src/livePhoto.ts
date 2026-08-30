/**
 * Live Photos.
 *
 * A Live Photo is two files: a still (`IMG_1234.HEIC`/`.JPG`) and a ~3 second
 * motion clip (`IMG_1234.MOV`/`.MP4`). Uploaded as-is they land in the library
 * as two unrelated assets, and the clip shows up as a short silent movie —
 * issue #154. This module is the whole model of "these two are one thing":
 * detection at upload time, and pairing at display time.
 *
 * **Detection** reads the clip's QuickTime metadata. Apple stamps every Live
 * Photo movie with `com.apple.quicktime.content.identifier`, the UUID that ties
 * it back to the still it was captured with; an ordinary video has no such key.
 * That read has to happen in the browser: photos are E2EE, so the server holds
 * ciphertext and `exiftool` on the server has nothing to look at. The parser
 * here is deliberately small and reads only the `moov` atom, so it costs a few
 * hundred KB of the file rather than all of it.
 *
 * **Pairing** cannot rely on that identifier alone. The still's copy of it is
 * buried in an Apple MakerNote we do not parse, the main library listing is
 * served by the generic Drive endpoint (which carries no photo metadata at
 * all), and anything uploaded before this shipped has no metadata either. So
 * pairing matches on the identifier when both halves carry it and falls back to
 * the filename stem, which is what Apple and Google Takeout both name the two
 * halves with. The issue calls the metadata "much more reliable" and it is —
 * hence the order — but the stem is what makes an existing library work.
 */

import type { PhotoResponse } from './index';

/** Apple's key for the UUID shared by a Live Photo's still and its movie. */
export const CONTENT_IDENTIFIER_KEY = 'com.apple.quicktime.content.identifier';
/** Apple's key marking which instant in the movie is the still frame. */
export const STILL_IMAGE_TIME_KEY = 'com.apple.quicktime.still-image-time';

/** A `moov` bigger than this is not worth reading for four bytes of metadata. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

export interface LivePhotoInfo {
  /** The UUID linking this movie to the still it was captured with. */
  contentIdentifier: string;
  /** Seconds into the clip that the still frame sits at, when the file says. */
  stillImageTime?: number;
}

// ---------------------------------------------------------------------------
// QuickTime atom parsing
// ---------------------------------------------------------------------------

interface Atom {
  /** Four-character type, e.g. `moov`. */
  type: string;
  /** The same four bytes as a big-endian integer — an `ilst` entry's key index. */
  typeCode: number;
  /** First byte of the atom's payload. */
  start: number;
  /** One past the atom's last byte. */
  end: number;
}

function viewOf(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

function fourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

/** Walk the atoms laid out between `from` and `to`, stopping at the first malformed one. */
function* atoms(buf: Uint8Array, from: number, to: number): Generator<Atom> {
  const view = viewOf(buf);
  let offset = from;
  while (offset + 8 <= to) {
    let size = view.getUint32(offset);
    let headerSize = 8;
    const type = fourCC(buf, offset + 4);
    const typeCode = view.getUint32(offset + 4);
    if (size === 1) {
      // 64-bit size, carried in the eight bytes after the type.
      if (offset + 16 > to) return;
      size = view.getUint32(offset + 8) * 0x1_0000_0000 + view.getUint32(offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      // "To the end of the enclosing atom."
      size = to - offset;
    }
    if (size < headerSize || offset + size > to) return;
    yield { type, typeCode, start: offset + headerSize, end: offset + size };
    offset += size;
  }
}

/** Does `offset` look like the start of an atom, rather than the middle of one? */
function looksLikeAtom(buf: Uint8Array, offset: number): boolean {
  if (offset + 8 > buf.length) return false;
  const size = viewOf(buf).getUint32(offset);
  if (size < 8 || offset + size > buf.length) return false;
  for (let i = offset + 4; i < offset + 8; i++) {
    if (buf[i] < 0x20 || buf[i] > 0x7e) return false;
  }
  return true;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
}

/**
 * Decode one `data` atom's payload. The four bytes at its head are a one-byte
 * version and a three-byte well-known-type indicator; the four after that are a
 * locale nobody sets.
 */
function decodeDataAtom(buf: Uint8Array, start: number, end: number): string | number | null {
  if (start + 8 > end) return null;
  const wellKnownType = viewOf(buf).getUint32(start) & 0x00ff_ffff;
  const payload = buf.subarray(start + 8, end);
  const view = viewOf(payload);
  switch (wellKnownType) {
    case 1: // UTF-8
      return decodeUtf8(payload);
    case 21: // signed big-endian integer
    case 22: {
      // unsigned big-endian integer
      if (payload.length === 0 || payload.length > 8) return null;
      let value = 0;
      for (const byte of payload) value = value * 256 + byte;
      if (wellKnownType === 21 && payload.length <= 6) {
        const range = 2 ** (payload.length * 8);
        if (value >= range / 2) value -= range;
      }
      return value;
    }
    case 23: // 32-bit float
      return payload.length >= 4 ? view.getFloat32(0) : null;
    case 24: // 64-bit float
      return payload.length >= 8 ? view.getFloat64(0) : null;
    case 0: {
      // Reserved/binary. Apple writes the content identifier this way in some
      // exports, so take it when it decodes to printable text and drop it
      // otherwise rather than handing back mojibake.
      const text = decodeUtf8(payload);
      return /^[\x20-\x7e]+$/.test(text) ? text : null;
    }
    default:
      return null;
  }
}

/** Parse a `keys` atom into the ordered key names its `ilst` entries index into. */
function parseKeys(buf: Uint8Array, start: number, end: number): string[] {
  const view = viewOf(buf);
  if (start + 8 > end) return [];
  const count = view.getUint32(start + 4);
  const keys: string[] = [];
  let offset = start + 8;
  for (let i = 0; i < count && offset + 8 <= end; i++) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > end) break;
    // Bytes 4..8 are the key namespace (`mdta`); the name is everything after.
    keys.push(decodeUtf8(buf.subarray(offset + 8, offset + size)));
    offset += size;
  }
  return keys;
}

/** Parse an `ilst` atom, resolving each entry's index against `keys`. */
function parseIlst(
  buf: Uint8Array,
  start: number,
  end: number,
  keys: string[],
  out: Record<string, string | number>,
): void {
  for (const entry of atoms(buf, start, end)) {
    const key = keys[entry.typeCode - 1];
    if (!key) continue;
    for (const data of atoms(buf, entry.start, entry.end)) {
      if (data.type !== 'data') continue;
      const value = decodeDataAtom(buf, data.start, data.end);
      if (value !== null && !(key in out)) out[key] = value;
    }
  }
}

function parseMetaAtom(
  buf: Uint8Array,
  start: number,
  end: number,
  out: Record<string, string | number>,
): void {
  // ISO-BMFF gives `meta` four bytes of version/flags; QuickTime's does not.
  // Which one this is can only be told by looking at what follows.
  let offset = start;
  if (!looksLikeAtom(buf, start) && looksLikeAtom(buf, start + 4)) offset = start + 4;

  let keys: string[] = [];
  const lists: Array<[number, number]> = [];
  for (const atom of atoms(buf, offset, end)) {
    if (atom.type === 'keys') keys = parseKeys(buf, atom.start, atom.end);
    else if (atom.type === 'ilst') lists.push([atom.start, atom.end]);
  }
  for (const [listStart, listEnd] of lists) parseIlst(buf, listStart, listEnd, keys, out);
}

/** Atoms that hold other atoms and can therefore hide a `meta` below them. */
const CONTAINER_ATOMS = new Set(['moov', 'trak', 'udta', 'mdia', 'minf']);

function collectMetadata(
  buf: Uint8Array,
  start: number,
  end: number,
  out: Record<string, string | number>,
): void {
  for (const atom of atoms(buf, start, end)) {
    if (atom.type === 'meta') parseMetaAtom(buf, atom.start, atom.end, out);
    else if (CONTAINER_ATOMS.has(atom.type)) collectMetadata(buf, atom.start, atom.end, out);
  }
}

/**
 * Read just the `moov` atom out of a QuickTime/MP4 file.
 *
 * Top-level atoms are walked by header alone — sixteen bytes per hop — so an
 * unfaststarted movie with `moov` at the tail costs a handful of small reads
 * rather than the whole file.
 */
async function readMoovAtom(source: Blob): Promise<Uint8Array | null> {
  let offset = 0;
  while (offset + 8 <= source.size) {
    const head = new Uint8Array(await source.slice(offset, offset + 16).arrayBuffer());
    if (head.length < 8) return null;
    const view = viewOf(head);
    let size = view.getUint32(0);
    let headerSize = 8;
    const type = fourCC(head, 4);
    if (size === 1) {
      if (head.length < 16) return null;
      size = view.getUint32(8) * 0x1_0000_0000 + view.getUint32(12);
      headerSize = 16;
    } else if (size === 0) {
      size = source.size - offset;
    }
    if (size < headerSize) return null;
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return null;
      const bytes = new Uint8Array(await source.slice(offset, offset + size).arrayBuffer());
      return bytes.subarray(headerSize);
    }
    offset += size;
  }
  return null;
}

/**
 * Read a QuickTime file's `moov` metadata as a plain key → value record.
 *
 * Returns null for anything that is not a QuickTime/MP4 file or carries no
 * metadata at all; a parse that runs off the end of a truncated atom stops
 * there and keeps whatever it had read.
 */
export async function readQuickTimeMetadata(
  source: Blob,
): Promise<Record<string, string | number> | null> {
  let moov: Uint8Array | null;
  try {
    moov = await readMoovAtom(source);
  } catch {
    return null;
  }
  if (!moov) return null;
  const out: Record<string, string | number> = {};
  collectMetadata(moov, 0, moov.length, out);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Does this movie's metadata mark it as the motion half of a Live Photo?
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

/**
 * Read a file's Live Photo identity, or null if it is not one.
 *
 * Call it on any movie about to be uploaded: a `null` answer means "an ordinary
 * video, treat it as one".
 */
export async function readLivePhotoInfo(source: Blob): Promise<LivePhotoInfo | null> {
  const metadata = await readQuickTimeMetadata(source);
  if (!metadata || !isLikelyLivePhotoMov(metadata)) return null;
  const raw =
    metadata[CONTENT_IDENTIFIER_KEY] ??
    metadata['quicktime:ContentIdentifier'] ??
    metadata['ContentIdentifier'] ??
    metadata['Content Identifier'];
  const contentIdentifier = String(raw).trim();
  if (!contentIdentifier) return null;

  const stillTime = metadata[STILL_IMAGE_TIME_KEY];
  return {
    contentIdentifier,
    // Apple writes -1 here when the still frame is marked by a timed-metadata
    // track instead, which we do not read; only keep a usable offset.
    ...(typeof stillTime === 'number' && Number.isFinite(stillTime) && stillTime >= 0
      ? { stillImageTime: stillTime }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// A representative frame
// ---------------------------------------------------------------------------

/**
 * Grab a frame out of a video as a base64 JPEG, in the shape `generateThumbnail`
 * returns for images (raw base64, no data-URL prefix, null on failure).
 *
 * This is what stops a Live Photo with no still beside it — the case the issue
 * calls out — from sitting in the library as a black tile. Without a hint from
 * the file the middle of the clip is the frame to take: Apple records roughly a
 * second and a half either side of the shutter, so the middle is the picture.
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
        console.warn('[livePhoto] could not draw video frame:', err);
        finish(null);
      }
    };

    video.onerror = () => {
      console.warn('[livePhoto] video load failed for', (file as File).name ?? 'blob');
      finish(null);
    };

    video.src = url;
  });
}

// ---------------------------------------------------------------------------
// Pairing a library listing
// ---------------------------------------------------------------------------

/** One tile in the library: a photo, plus the motion clip belonging to it. */
export interface LibraryItem {
  /** The asset the tile shows — the still, whenever there is one. */
  photo: PhotoResponse;
  /** The motion half of a Live Photo, or null for an ordinary asset. */
  motion: PhotoResponse | null;
  /** True for a Live Photo, whether or not both halves are present. */
  isLive: boolean;
}

function isImage(photo: PhotoResponse): boolean {
  return photo.mimeType.startsWith('image/');
}

function isVideo(photo: PhotoResponse): boolean {
  return photo.mimeType.startsWith('video/');
}

/** The identifier recorded on the photo at upload time, if it has one. */
export function livePhotoIdentifier(photo: PhotoResponse): string | null {
  const id = photo.metadata?.livePhoto?.contentIdentifier;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The filename both halves of a Live Photo share — `IMG_1234.HEIC` and
 * `IMG_1234.MOV` both reduce to `img_1234`.
 *
 * Takeout's copy suffix (`IMG_1234(1).JPG`) is dropped too, since it numbers the
 * duplicate rather than the picture.
 */
export function livePhotoStem(fileName: string): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  const withoutExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const stem = withoutExt.replace(/\(\d+\)$/, '').trim().toLowerCase();
  return stem.length > 0 ? stem : null;
}

/**
 * Fold a listing's Live Photo movies into the stills they belong to.
 *
 * `items` is the listing as shown: images stay, and a video stays too unless it
 * is claimed as some still's motion half — the archive and favourites tabs list
 * ordinary videos and should keep doing so. `motionCandidates` are files pulled
 * in only to be paired (the main tab's listing carries images alone, so the
 * clips have to be fetched separately); an unclaimed one is dropped unless it is
 * itself a Live Photo with no still, which earns its own tile.
 */
export function pairLivePhotos(
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
    const identifier = livePhotoIdentifier(still);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, still);
    const stem = livePhotoStem(still.fileName);
    if (stem && !byStem.has(stem)) byStem.set(stem, still);
  }

  const motionByStill = new Map<string, PhotoResponse>();
  const claimed = new Set<string>();
  for (const clip of candidates) {
    const identifier = livePhotoIdentifier(clip);
    const stem = livePhotoStem(clip.fileName);
    const still =
      (identifier ? byIdentifier.get(identifier) : undefined) ??
      (stem ? byStem.get(stem) : undefined);
    // Metadata beats the filename, so a clip that already matched by identifier
    // is never displaced; the first clip to claim a still keeps it.
    if (!still || motionByStill.has(still.id)) continue;
    motionByStill.set(still.id, clip);
    claimed.add(clip.id);
  }

  const result: LibraryItem[] = [];
  for (const item of items) {
    if (isVideo(item) && claimed.has(item.id)) continue;
    const motion = motionByStill.get(item.id) ?? null;
    result.push({
      photo: item,
      motion,
      isLive: motion !== null || livePhotoIdentifier(item) !== null,
    });
  }
  for (const clip of candidates) {
    if (claimed.has(clip.id) || listed.has(clip.id)) continue;
    // A Live Photo whose still never made it into the library still belongs on
    // screen; an ordinary video pulled in only as a candidate does not.
    if (livePhotoIdentifier(clip)) result.push({ photo: clip, motion: null, isLive: true });
  }
  return result;
}
