/**
 * Carrying a photo's EXIF from one image to another (issue #317).
 *
 * A Live Photo's new key photo is a video frame drawn to a canvas, and a canvas
 * JPEG carries no EXIF at all — no capture date, no place, no camera, and no
 * Apple MakerNote, which holds the content identifier Apple Photos pairs a still
 * with its clip by. So the original still's EXIF is copied across.
 *
 * It is copied **whole**: the TIFF block is lifted out of the original (a JPEG's
 * `APP1`, or a HEIC's `Exif` item) and dropped into the new JPEG's `APP1`. TIFF
 * offsets are relative to the block's own header, and Apple's MakerNote uses
 * offsets relative to itself, so a block moved intact stays valid — the
 * MakerNote is carried byte for byte without being parsed. Only integers are
 * then overwritten in place: `Orientation` becomes 1 (the frame's pixels are
 * already upright), the pixel dimensions become the frame's, and IFD0's link to
 * IFD1 is cut, since IFD1 is an embedded thumbnail of the *old* picture.
 *
 * Nothing here touches the DOM or the network.
 */

/** JPEG `APP1` holds at most 65,533 bytes after its length field; less the `Exif\0\0` tag. */
const MAX_APP1_TIFF_BYTES = 65533 - 6;

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

const TAG_IMAGE_WIDTH = 0x0100;
const TAG_IMAGE_LENGTH = 0x0101;
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_PIXEL_X = 0xa002;
const TAG_PIXEL_Y = 0xa003;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function startsWithExifHeader(bytes: Uint8Array, at: number): boolean {
  return EXIF_HEADER.every((b, i) => bytes[at + i] === b);
}

// ---------------------------------------------------------------------------
// Extracting
// ---------------------------------------------------------------------------

/** The TIFF block from a JPEG's `APP1 Exif` segment. */
function jpegExif(bytes: Uint8Array): Uint8Array | null {
  const v = view(bytes);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Start of scan or end of image: the headers are over.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = v.getUint16(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (marker === 0xe1 && startsWithExifHeader(bytes, at + 4)) {
      return bytes.slice(at + 10, at + 2 + length);
    }
    at += 2 + length;
  }
  return null;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(bytes: Uint8Array, from: number, to: number): Generator<Box> {
  const v = view(bytes);
  let at = from;
  while (at + 8 <= to) {
    let size = v.getUint32(at);
    let header = 8;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (size === 1) {
      if (at + 16 > to) return;
      size = v.getUint32(at + 8) * 0x1_0000_0000 + v.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function readSized(v: DataView, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return v.getUint32(at);
  if (size === 8) return v.getUint32(at) * 0x1_0000_0000 + v.getUint32(at + 4);
  if (size === 2) return v.getUint16(at);
  throw new Error(`unsupported field size ${size}`);
}

/** The TIFF block from a HEIC/HEIF's `Exif` item (`meta` → `iinf` + `iloc`). */
function heifExif(bytes: Uint8Array): Uint8Array | null {
  const v = view(bytes);
  const meta = [...boxes(bytes, 0, bytes.length)].find((b) => b.type === 'meta');
  if (!meta) return null;
  // `meta` is a full box.
  const children = [...boxes(bytes, meta.start + 4, meta.end)];
  const iinf = children.find((b) => b.type === 'iinf');
  const iloc = children.find((b) => b.type === 'iloc');
  if (!iinf || !iloc) return null;

  // Which item is the Exif one?
  let exifItem: number | null = null;
  const iinfVersion = bytes[iinf.start];
  const entriesFrom = iinf.start + 4 + (iinfVersion === 0 ? 2 : 4);
  for (const infe of boxes(bytes, entriesFrom, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const version = bytes[infe.start];
    if (version < 2) continue;
    const idSize = version === 2 ? 2 : 4;
    const id = readSized(v, infe.start + 4, idSize);
    const typeAt = infe.start + 4 + idSize + 2;
    const type = String.fromCharCode(bytes[typeAt], bytes[typeAt + 1], bytes[typeAt + 2], bytes[typeAt + 3]);
    if (type === 'Exif') {
      exifItem = id;
      break;
    }
  }
  if (exifItem === null) return null;

  // Where its bytes are.
  const ilocVersion = bytes[iloc.start];
  let at = iloc.start + 4;
  const offsetSize = bytes[at] >> 4;
  const lengthSize = bytes[at] & 0x0f;
  const baseOffsetSize = bytes[at + 1] >> 4;
  const indexSize = ilocVersion === 1 || ilocVersion === 2 ? bytes[at + 1] & 0x0f : 0;
  at += 2;
  const itemCount = ilocVersion < 2 ? v.getUint16(at) : v.getUint32(at);
  at += ilocVersion < 2 ? 2 : 4;
  for (let i = 0; i < itemCount && at < iloc.end; i++) {
    const id = ilocVersion < 2 ? v.getUint16(at) : v.getUint32(at);
    at += ilocVersion < 2 ? 2 : 4;
    let construction = 0;
    if (ilocVersion === 1 || ilocVersion === 2) {
      construction = v.getUint16(at) & 0x0f;
      at += 2;
    }
    at += 2; // data reference index
    const base = readSized(v, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = v.getUint16(at);
    at += 2;
    const parts: Uint8Array[] = [];
    for (let e = 0; e < extentCount; e++) {
      at += indexSize;
      const offset = readSized(v, at, offsetSize);
      at += offsetSize;
      const length = readSized(v, at, lengthSize);
      at += lengthSize;
      parts.push(bytes.subarray(base + offset, base + offset + length));
    }
    if (id !== exifItem) continue;
    // Only file-offset construction is something a HEIC from a camera uses.
    if (construction !== 0 || parts.length === 0) return null;
    const total = parts.reduce((n, p) => n + p.length, 0);
    const item = new Uint8Array(total);
    let fill = 0;
    for (const p of parts) {
      item.set(p, fill);
      fill += p.length;
    }
    // The item opens with a 4-byte offset to the TIFF header, usually skipping `Exif\0\0`.
    if (item.length < 4) return null;
    const tiffAt = 4 + view(item).getUint32(0);
    return tiffAt < item.length ? item.slice(tiffAt) : null;
  }
  return null;
}

/**
 * The EXIF TIFF block (starting at its `II`/`MM` byte-order mark) of a JPEG or
 * HEIC/HEIF, or null when it has none.
 */
export function extractExifTiff(image: Uint8Array): Uint8Array | null {
  try {
    const tiff = isJpeg(image) ? jpegExif(image) : heifExif(image);
    return tiff && tiffByteOrder(tiff) ? tiff : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Patching
// ---------------------------------------------------------------------------

function tiffByteOrder(tiff: Uint8Array): 'II' | 'MM' | null {
  if (tiff.length < 8) return null;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) return 'II';
  if (tiff[0] === 0x4d && tiff[1] === 0x4d) return 'MM';
  return null;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Offset of the 4-byte value/offset field. */
  valueAt: number;
}

function readIfd(v: DataView, at: number, little: boolean): { entries: IfdEntry[]; nextAt: number } | null {
  if (at + 2 > v.byteLength) return null;
  const count = v.getUint16(at, little);
  const entries: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > v.byteLength) return null;
    entries.push({ tag: v.getUint16(e, little), type: v.getUint16(e + 2, little), count: v.getUint32(e + 4, little), valueAt: e + 8 });
  }
  const nextAt = at + 2 + count * 12;
  return nextAt + 4 <= v.byteLength ? { entries, nextAt } : null;
}

/** Overwrite an inline SHORT or LONG, if the value fits the type it already has. */
function setInline(v: DataView, entry: IfdEntry, value: number, little: boolean): void {
  if (entry.count !== 1) return;
  if (entry.type === TYPE_SHORT && value <= 0xffff) v.setUint16(entry.valueAt, value, little);
  else if (entry.type === TYPE_LONG) v.setUint32(entry.valueAt, value, little);
}

export interface ExifPatch {
  /** The new image's pixel width and height. */
  width: number;
  height: number;
}

/**
 * A copy of `tiff` with `Orientation` = 1, the pixel dimensions set, and the
 * link to IFD1 (the old picture's thumbnail) cut. Every other byte — dates,
 * GPS, make, model, lens, the MakerNote — is as it was. Fields are only ever
 * overwritten where they stand; one the original did not have is not added.
 */
export function patchExifTiff(tiff: Uint8Array, patch: ExifPatch): Uint8Array {
  const out = tiff.slice();
  const order = tiffByteOrder(out);
  if (!order) return out;
  const little = order === 'II';
  const v = view(out);
  const ifd0 = readIfd(v, v.getUint32(4, little), little);
  if (!ifd0) return out;

  for (const entry of ifd0.entries) {
    if (entry.tag === TAG_ORIENTATION) setInline(v, entry, 1, little);
    else if (entry.tag === TAG_IMAGE_WIDTH) setInline(v, entry, patch.width, little);
    else if (entry.tag === TAG_IMAGE_LENGTH) setInline(v, entry, patch.height, little);
    else if (entry.tag === TAG_EXIF_IFD) {
      const exif = readIfd(v, v.getUint32(entry.valueAt, little), little);
      for (const sub of exif?.entries ?? []) {
        if (sub.tag === TAG_PIXEL_X) setInline(v, sub, patch.width, little);
        else if (sub.tag === TAG_PIXEL_Y) setInline(v, sub, patch.height, little);
      }
    }
  }
  // No IFD1: its thumbnail is of the picture this one replaces.
  v.setUint32(ifd0.nextAt, 0, little);
  return out;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * `jpeg` with its own EXIF (if any) dropped and `tiff` inserted as an
 * `APP1 Exif` segment straight after SOI — or null when the block is too big
 * for one `APP1` segment.
 */
export function insertExifIntoJpeg(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  if (!isJpeg(jpeg) || tiff.length > MAX_APP1_TIFF_BYTES) return null;
  const v = view(jpeg);

  // Keep every header segment except an existing APP1 Exif.
  const kept: Uint8Array[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length) {
    const marker = jpeg[at + 1];
    if (jpeg[at] !== 0xff || marker === 0xda || marker === 0xd9) break;
    const length = v.getUint16(at + 2);
    if (length < 2 || at + 2 + length > jpeg.length) return null;
    const isExif = marker === 0xe1 && startsWithExifHeader(jpeg, at + 4);
    if (!isExif) kept.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  const rest = jpeg.subarray(at);

  const segmentLength = 2 + EXIF_HEADER.length + tiff.length;
  const app1 = new Uint8Array(2 + segmentLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  view(app1).setUint16(2, segmentLength);
  app1.set(EXIF_HEADER, 4);
  app1.set(tiff, 4 + EXIF_HEADER.length);

  const parts = [jpeg.subarray(0, 2), app1, ...kept, rest];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let fill = 0;
  for (const p of parts) {
    out.set(p, fill);
    fill += p.length;
  }
  return out;
}

export interface ExifCopyResult {
  bytes: Uint8Array;
  /** False when the original had no EXIF, or it would not fit a JPEG segment. */
  copied: boolean;
}

/** `frameJpeg` carrying `original`'s EXIF, patched for the frame's size and upright pixels. */
export function copyExifToJpeg(original: Uint8Array, frameJpeg: Uint8Array, patch: ExifPatch): ExifCopyResult {
  const tiff = extractExifTiff(original);
  if (!tiff) return { bytes: frameJpeg, copied: false };
  const withExif = insertExifIntoJpeg(frameJpeg, patchExifTiff(tiff, patch));
  return withExif ? { bytes: withExif, copied: true } : { bytes: frameJpeg, copied: false };
}
