/**
 * PNG chunks, as bytes.
 *
 * A canvas can encode a PNG and cannot put anything *in* it — no colour
 * profile, no depth, no private data — so an embedded ICC profile means
 * rewriting the file the browser produced. That is a small, exactly specified
 * job: a PNG is an eight-byte signature followed by chunks of
 * `length · type · data · CRC`, and inserting one is copying the bytes with a
 * new chunk spliced in after `IHDR` (which must be first) and before `IDAT`
 * (which must come after every chunk that describes how to interpret it).
 *
 * Everything here is pure and synchronous over `Uint8Array`, which is what lets
 * the CRC, the splice and the bit-depth read be tested without a browser. The
 * one thing that cannot be is the zlib compression an `iCCP` chunk requires;
 * that is `deflate.ts`, injected.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

// ---------------------------------------------------------------------------
// CRC
// ---------------------------------------------------------------------------

/**
 * The CRC-32 the PNG specification defines, table-driven.
 *
 * The table is built once on first use rather than written out as 256
 * constants: it is eight lines of arithmetic against a page of numbers that
 * would have to be trusted, and a chunk with a wrong CRC is rejected outright
 * by decoders — so this is one of the few places where "obviously correct"
 * beats "already computed".
 */
let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const next = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    next[n] = c >>> 0;
  }
  crcTable = next;
  return next;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface PngChunk {
  type: string;
  /** Offset of the chunk's length field, so a splice knows where to cut. */
  start: number;
  /** One past the chunk's CRC — the offset the next chunk starts at. */
  end: number;
  dataStart: number;
  length: number;
}

/**
 * Every chunk in order, or null for bytes that are not a PNG.
 *
 * Stops at `IEND` rather than reading to the end of the buffer: some encoders
 * append padding, and a `.ora` archive entry is not necessarily trimmed.
 */
export function readChunks(bytes: Uint8Array): PngChunk[] | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];

  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const end = offset + 12 + length;
    if (end > bytes.length) return chunks.length ? chunks : null;
    chunks.push({ type, start: offset, end, dataStart: offset + 8, length });
    if (type === 'IEND') break;
    offset = end;
  }
  return chunks.length ? chunks : null;
}

/**
 * The bit depth declared in the IHDR — 1, 2, 4, 8 or 16 bits per channel.
 *
 * Read here rather than inferred from the decoded image, because decoding is
 * exactly what loses it: a browser hands back eight bits per channel whatever
 * the file said, so this is the only moment the original depth exists.
 */
export function pngBitDepth(bytes: Uint8Array): number | null {
  if (!isPng(bytes) || bytes.length < 26) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  return bytes[24];
}

export function hasChunk(bytes: Uint8Array, type: string): boolean {
  return readChunks(bytes)?.some((chunk) => chunk.type === type) ?? false;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** One chunk, framed: length, type, data, CRC over type and data. */
export function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type *and* the data, and not the length — the single
  // most common way to write an unreadable chunk by hand.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/**
 * The same PNG with `chunk` inserted directly after `IHDR`.
 *
 * After IHDR because the specification requires IHDR first; before IDAT because
 * every chunk that says how to interpret the pixels has to precede them, and
 * `iCCP` is one.
 */
export function insertAfterIhdr(bytes: Uint8Array, chunk: Uint8Array): Uint8Array | null {
  const chunks = readChunks(bytes);
  const ihdr = chunks?.find((c) => c.type === 'IHDR');
  if (!ihdr) return null;

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, ihdr.end), 0);
  out.set(chunk, ihdr.end);
  out.set(bytes.subarray(ihdr.end), ihdr.end + chunk.length);
  return out;
}

/**
 * The data half of an `iCCP` chunk: a Latin-1 profile name, a null byte, the
 * compression method (only zlib is defined), then the zlib-compressed profile.
 *
 * The name is trimmed to the 79 bytes the format allows and stripped of
 * anything outside printable Latin-1 — a profile description can contain
 * anything, and a decoder is entitled to reject a chunk whose name does not
 * match the grammar, which would cost the profile rather than the character.
 */
export function buildIccpData(name: string, compressedProfile: Uint8Array): Uint8Array {
  const safe = name.replace(/[^\x20-\x7e\xa1-\xff]/g, ' ').trim().slice(0, 79) || 'ICC profile';
  const out = new Uint8Array(safe.length + 2 + compressedProfile.length);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i) & 0xff;
  out[safe.length] = 0;
  out[safe.length + 1] = 0;
  out.set(compressedProfile, safe.length + 2);
  return out;
}

/**
 * A PNG carrying an embedded ICC profile.
 *
 * Returns the original bytes unchanged when it already has one — re-embedding
 * would put two `iCCP` chunks in a file that may legally contain one — and null
 * when the input is not a PNG, so the caller can tell "nothing to do" from
 * "could not do it".
 */
export function embedIccProfile(
  bytes: Uint8Array,
  name: string,
  compressedProfile: Uint8Array,
): Uint8Array | null {
  if (!isPng(bytes)) return null;
  if (hasChunk(bytes, 'iCCP')) return bytes;
  return insertAfterIhdr(bytes, buildChunk('iCCP', buildIccpData(name, compressedProfile)));
}
