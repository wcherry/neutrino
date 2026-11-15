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
// The key frame: Apple's `still-image-time` timed metadata track (issue #317)
// ---------------------------------------------------------------------------
//
// On an iPhone clip, `com.apple.quicktime.still-image-time` is normally not a
// value in `moov/meta/ilst` but a *timed metadata track*: a `trak` whose
// `mdia/hdlr` is `meta`, whose `stsd` holds a `mebx` sample entry declaring the
// key, and whose one meaningful sample (value -1) is placed *at* the key-frame
// time. The value means nothing; the sample's timestamp is the answer.
//
// Reading it is box walking and arithmetic over the timing tables — `stts`
// (sample durations, media timescale) and `edts/elst` (the edit list, movie
// timescale) — and so is moving it. Nothing here decodes media.

/** The key Apple's timed metadata track declares. */
export const STILL_IMAGE_TIME_TRACK_KEY = 'com.apple.quicktime.still-image-time';

interface EditEntry {
  /** In movie timescale units. */
  segmentDuration: number;
  /** In media timescale units; -1 marks an empty edit. */
  mediaTime: number;
  /** Absolute byte offset of `segmentDuration`. */
  durationOffset: number;
}

interface SttsEntry {
  count: number;
  /** In media timescale units. */
  delta: number;
  /** Absolute byte offset of `delta`. */
  deltaOffset: number;
}

interface StillTimeTrack {
  movieTimescale: number;
  mediaTimescale: number;
  /** null when the track has no edit list. */
  edits: { version: 0 | 1; entries: EditEntry[] } | null;
  stts: SttsEntry[];
}

function childOf(buf: Uint8Array, start: number, end: number, type: string): Atom | null {
  for (const atom of atoms(buf, start, end)) if (atom.type === type) return atom;
  return null;
}

/** `mvhd` or `mdhd`: the timescale sits after version/flags and two timestamps. */
function headerTimescale(buf: Uint8Array, atom: Atom): number | null {
  const view = viewOf(buf);
  if (atom.start + 4 > atom.end) return null;
  const version = buf[atom.start];
  const at = atom.start + (version === 1 ? 20 : 12);
  if (at + 4 > atom.end) return null;
  const scale = view.getUint32(at);
  return scale > 0 ? scale : null;
}

/** Does this `mebx` sample entry declare `still-image-time` among its keys? */
function mebxDeclaresStillTime(buf: Uint8Array, entry: Atom): boolean {
  // A sample entry's payload opens with six reserved bytes and a data-reference index.
  const keys = childOf(buf, entry.start + 8, entry.end, 'keys');
  if (!keys) return false;
  // `keys` here is a plain box of key boxes; tolerate a full-box header too.
  let from = keys.start;
  if (!looksLikeAtom(buf, from) && looksLikeAtom(buf, from + 4)) from += 4;
  for (const key of atoms(buf, from, keys.end)) {
    const keyd = childOf(buf, key.start, key.end, 'keyd');
    // `keyd`: a four-byte namespace (`mdta`) and then the key itself.
    if (keyd && keyd.start + 4 <= keyd.end) {
      if (decodeUtf8(buf.subarray(keyd.start + 4, keyd.end)) === STILL_IMAGE_TIME_TRACK_KEY) return true;
    }
  }
  return false;
}

function parseElst(buf: Uint8Array, elst: Atom): StillTimeTrack['edits'] {
  const view = viewOf(buf);
  const version = buf[elst.start] === 1 ? 1 : 0;
  const count = view.getUint32(elst.start + 4);
  const entrySize = version === 1 ? 20 : 12;
  const entries: EditEntry[] = [];
  let at = elst.start + 8;
  for (let i = 0; i < count && at + entrySize <= elst.end; i++, at += entrySize) {
    if (version === 1) {
      const segmentDuration = view.getUint32(at) * 0x1_0000_0000 + view.getUint32(at + 4);
      const hi = view.getInt32(at + 8);
      const mediaTime = hi === -1 && view.getUint32(at + 12) === 0xffff_ffff ? -1 : hi * 0x1_0000_0000 + view.getUint32(at + 12);
      entries.push({ segmentDuration, mediaTime, durationOffset: at });
    } else {
      entries.push({ segmentDuration: view.getUint32(at), mediaTime: view.getInt32(at + 4), durationOffset: at });
    }
  }
  return { version, entries };
}

function parseStts(buf: Uint8Array, stts: Atom): SttsEntry[] {
  const view = viewOf(buf);
  const count = view.getUint32(stts.start + 4);
  const out: SttsEntry[] = [];
  let at = stts.start + 8;
  for (let i = 0; i < count && at + 8 <= stts.end; i++, at += 8) {
    out.push({ count: view.getUint32(at), delta: view.getUint32(at + 4), deltaOffset: at + 4 });
  }
  return out;
}

/** The `still-image-time` track under the `moov` payload at [start, end), or null. */
function findStillTimeTrack(buf: Uint8Array, start: number, end: number): StillTimeTrack | null {
  const mvhd = childOf(buf, start, end, 'mvhd');
  const movieTimescale = mvhd ? headerTimescale(buf, mvhd) : null;
  if (!movieTimescale) return null;

  for (const trak of atoms(buf, start, end)) {
    if (trak.type !== 'trak') continue;
    const mdia = childOf(buf, trak.start, trak.end, 'mdia');
    if (!mdia) continue;
    const hdlr = childOf(buf, mdia.start, mdia.end, 'hdlr');
    // `hdlr`: version/flags, a pre-defined (component type) word, then the handler type.
    if (!hdlr || hdlr.start + 12 > hdlr.end || fourCC(buf, hdlr.start + 8) !== 'meta') continue;
    const stbl = childOf(buf, mdia.start, mdia.end, 'minf');
    const table = stbl ? childOf(buf, stbl.start, stbl.end, 'stbl') : null;
    const stsd = table ? childOf(buf, table.start, table.end, 'stsd') : null;
    const sttsAtom = table ? childOf(buf, table.start, table.end, 'stts') : null;
    if (!stsd || !sttsAtom) continue;
    // `stsd`: version/flags and an entry count ahead of the sample entries.
    const declares = [...atoms(buf, stsd.start + 8, stsd.end)].some(
      (entry) => entry.type === 'mebx' && mebxDeclaresStillTime(buf, entry),
    );
    if (!declares) continue;

    const mdhd = childOf(buf, mdia.start, mdia.end, 'mdhd');
    const mediaTimescale = mdhd ? headerTimescale(buf, mdhd) : null;
    if (!mediaTimescale) return null;
    const edts = childOf(buf, trak.start, trak.end, 'edts');
    const elst = edts ? childOf(buf, edts.start, edts.end, 'elst') : null;
    return {
      movieTimescale,
      mediaTimescale,
      edits: elst ? parseElst(buf, elst) : null,
      stts: parseStts(buf, sttsAtom),
    };
  }
  return null;
}

/**
 * The key sample is the track's last: a track with one sample is just that
 * sample, and one with a leading filler is filler-then-key.
 */
function keySampleDecodeTime(track: StillTimeTrack): number | null {
  const total = track.stts.reduce((n, e) => n + e.count, 0);
  if (total === 0) return null;
  let remaining = total - 1;
  let time = 0;
  for (const entry of track.stts) {
    const take = Math.min(entry.count, remaining);
    time += take * entry.delta;
    remaining -= take;
    if (remaining === 0) break;
  }
  return time;
}

/** A media-time instant mapped through the edit list to seconds of movie time. */
function movieSeconds(track: StillTimeTrack, mediaTime: number): number | null {
  const { movieTimescale, mediaTimescale, edits } = track;
  if (!edits || edits.entries.length === 0) return mediaTime / mediaTimescale;
  let movieCursor = 0;
  for (const edit of edits.entries) {
    if (edit.mediaTime === -1) {
      movieCursor += edit.segmentDuration;
      continue;
    }
    const mediaSpan = (edit.segmentDuration * mediaTimescale) / movieTimescale;
    // The key sample may sit exactly at the end of the presentation, so the
    // edit's end is inclusive.
    if (mediaTime >= edit.mediaTime && mediaTime <= edit.mediaTime + mediaSpan) {
      return (movieCursor + ((mediaTime - edit.mediaTime) * movieTimescale) / mediaTimescale) / movieTimescale;
    }
    movieCursor += edit.segmentDuration;
  }
  return null;
}

function stillTimeFromTrack(track: StillTimeTrack): number | null {
  const decode = keySampleDecodeTime(track);
  if (decode === null) return null;
  const seconds = movieSeconds(track, decode);
  return seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Top-level `moov` of a whole file in memory: [payloadStart, end), or null. */
function topLevelMoov(buf: Uint8Array): Atom | null {
  return childOf(buf, 0, buf.length, 'moov');
}

/**
 * The key-frame time, in seconds of movie time, from a whole file in memory —
 * or null when it has no `still-image-time` track.
 */
export function readStillImageTimeTrack(bytes: Uint8Array): number | null {
  try {
    const moov = topLevelMoov(bytes);
    const track = moov ? findStillTimeTrack(bytes, moov.start, moov.end) : null;
    return track ? stillTimeFromTrack(track) : null;
  } catch {
    return null;
  }
}

/**
 * Move a clip's key frame to `seconds`, in place — or null when its layout is
 * not one this recognises.
 *
 * Two layouts place the key sample, and each is moved by editing one pair of
 * integers so the total is unchanged:
 *
 * - **An empty edit.** The track's `elst` opens with an entry whose media time
 *   is -1; its duration (movie timescale) *is* the offset. That duration becomes
 *   the new time and the next entry's shrinks or grows by the same amount.
 * - **A leading filler sample.** No empty edit, and `stts` holds two
 *   one-sample entries: filler, then key. The filler's duration (media
 *   timescale) becomes the new time and the key's takes up the difference.
 *
 * Integers are overwritten where they stand, so no box changes size and no
 * `stco`/`co64` chunk offset needs shifting, whichever end of the file `moov`
 * is at; `tkhd`, `mdhd` and `mvhd` are not touched, so track and movie
 * durations are what they were. Video and audio sample bytes are not touched.
 * Anything else — no such track, an edit list with a non-zero start, a time
 * past the end of the track, a layout with the filler folded into a shared
 * `stts` entry — is refused rather than guessed at.
 */
export function rewriteStillImageTime(bytes: Uint8Array, seconds: number): Uint8Array | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  let track: StillTimeTrack | null;
  try {
    const moov = topLevelMoov(bytes);
    track = moov ? findStillTimeTrack(bytes, moov.start, moov.end) : null;
  } catch {
    return null;
  }
  if (!track) return null;
  const decode = keySampleDecodeTime(track);
  if (decode === null) return null;

  const out = new Uint8Array(bytes);
  const view = viewOf(out);
  const edits = track.edits;

  // Layout 1: an empty edit carries the offset.
  if (edits && edits.entries.length >= 2 && edits.entries[0].mediaTime === -1 && edits.entries[1].mediaTime >= 0) {
    const [empty, next] = edits.entries;
    // The key sample must be the first thing the second edit shows.
    if (decode !== next.mediaTime) return null;
    const target = Math.round(seconds * track.movieTimescale);
    const shift = target - empty.segmentDuration;
    const nextDuration = next.segmentDuration - shift;
    if (target < 0 || nextDuration <= 0) return null;
    if (edits.version === 0) {
      if (target > 0xffff_ffff || nextDuration > 0xffff_ffff) return null;
      view.setUint32(empty.durationOffset, target);
      view.setUint32(next.durationOffset, nextDuration);
    } else {
      writeUint64(view, empty.durationOffset, target);
      writeUint64(view, next.durationOffset, nextDuration);
    }
    return out;
  }

  // Layout 2: a leading filler sample carries the offset.
  const editsAreIdentity =
    !edits ||
    edits.entries.length === 0 ||
    (edits.entries.length === 1 && edits.entries[0].mediaTime === 0 && track.movieTimescale > 0);
  const total = track.stts.reduce((n, e) => n + e.count, 0);
  if (
    editsAreIdentity &&
    total === 2 &&
    track.stts.length === 2 &&
    track.stts[0].count === 1 &&
    track.stts[1].count === 1
  ) {
    const [filler, key] = track.stts;
    const target = Math.round(seconds * track.mediaTimescale);
    const shift = target - filler.delta;
    const keyDuration = key.delta - shift;
    if (target <= 0 || keyDuration <= 0 || target > 0xffff_ffff || keyDuration > 0xffff_ffff) return null;
    view.setUint32(filler.deltaOffset, target);
    view.setUint32(key.deltaOffset, keyDuration);
    return out;
  }

  return null;
}

function writeUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, Math.floor(value / 0x1_0000_0000));
  view.setUint32(offset + 4, value >>> 0);
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

export interface QuickTimeBoxes {
  /** Keyed metadata from every `meta` atom under `moov`, flattened. */
  metadata: Record<string, string | number>;
  /** The file's XMP packet, from a top-level `uuid` box or `moov/udta/XMP_`. */
  xmp: string | null;
  /**
   * Seconds into the movie of Apple's key frame, from the `still-image-time`
   * timed metadata track, or null when the movie has none.
   */
  stillImageTime: number | null;
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
  let stillImageTime: number | null = null;

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
        const track = findStillTimeTrack(moov, 0, moov.length);
        stillImageTime = stillImageTime ?? (track ? stillTimeFromTrack(track) : null);
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

  return { metadata, xmp, stillImageTime };
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
