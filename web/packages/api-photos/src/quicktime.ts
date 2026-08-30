/**
 * Just enough QuickTime/ISO-BMFF to read a movie's metadata in the browser.
 *
 * Both halves of motion-photo detection start here: Apple stamps a Live Photo's
 * clip with keyed metadata under `moov`, and Google stamps a Motion Photo's
 * with an XMP packet in a top-level `uuid` box (or `moov/udta/XMP_`). Neither
 * can be read on the server — photo content is E2EE, so the server holds
 * ciphertext — hence a parser small enough to ship to the browser.
 *
 * Nothing here decodes media. Top-level boxes are walked by header alone, so an
 * unfaststarted movie with `moov` at the tail costs a handful of 16-byte reads
 * rather than the whole file.
 */

/** A `moov` bigger than this is not worth reading for a few bytes of metadata. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

/** The UUID that marks an ISO-BMFF `uuid` box as carrying an XMP packet. */
const XMP_BOX_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
];

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

// ---------------------------------------------------------------------------
// Keyed metadata (`moov/meta`)
// ---------------------------------------------------------------------------

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

/** The XMP packet Google writes into `moov/udta/XMP_`, if this movie has one. */
function findUdtaXmp(moov: Uint8Array): string | null {
  for (const atom of atoms(moov, 0, moov.length)) {
    if (atom.type === 'udta') {
      for (const child of atoms(moov, atom.start, atom.end)) {
        if (child.type === 'XMP_') return decodeUtf8(moov.subarray(child.start, child.end));
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

export interface QuickTimeBoxes {
  /** Keyed metadata from every `meta` atom under `moov`, flattened. */
  metadata: Record<string, string | number>;
  /** The file's XMP packet, from a top-level `uuid` box or `moov/udta/XMP_`. */
  xmp: string | null;
}

/**
 * Read a QuickTime/MP4 file's metadata and XMP packet in one pass.
 *
 * Returns empty metadata and a null packet for anything that is not a QuickTime
 * or MP4 file; a parse that runs off the end of a truncated atom stops there and
 * keeps whatever it had read.
 */
export async function readQuickTimeBoxes(source: Blob): Promise<QuickTimeBoxes> {
  const metadata: Record<string, string | number> = {};
  let xmp: string | null = null;

  try {
    let offset = 0;
    while (offset + 8 <= source.size) {
      const head = new Uint8Array(await source.slice(offset, offset + 16).arrayBuffer());
      if (head.length < 8) break;
      const view = viewOf(head);
      let size = view.getUint32(0);
      let headerSize = 8;
      const type = fourCC(head, 4);
      if (size === 1) {
        if (head.length < 16) break;
        size = view.getUint32(8) * 0x1_0000_0000 + view.getUint32(12);
        headerSize = 16;
      } else if (size === 0) {
        size = source.size - offset;
      }
      if (size < headerSize) break;

      if (type === 'moov' && size <= MAX_MOOV_BYTES) {
        const box = new Uint8Array(await source.slice(offset, offset + size).arrayBuffer());
        const moov = box.subarray(headerSize);
        collectMetadata(moov, 0, moov.length, metadata);
        xmp = xmp ?? findUdtaXmp(moov);
      } else if (type === 'uuid' && size <= MAX_MOOV_BYTES) {
        const box = new Uint8Array(await source.slice(offset, offset + size).arrayBuffer());
        const uuid = box.subarray(headerSize, headerSize + 16);
        if (uuid.length === 16 && XMP_BOX_UUID.every((byte, i) => uuid[i] === byte)) {
          xmp = xmp ?? decodeUtf8(box.subarray(headerSize + 16));
        }
      }

      offset += size;
    }
  } catch {
    // A truncated or unreadable file is simply one with no metadata.
  }

  return { metadata, xmp };
}

/**
 * A QuickTime file's `moov` metadata as a plain key → value record, or null when
 * it has none.
 */
export async function readQuickTimeMetadata(
  source: Blob,
): Promise<Record<string, string | number> | null> {
  const { metadata } = await readQuickTimeBoxes(source);
  return Object.keys(metadata).length > 0 ? metadata : null;
}
