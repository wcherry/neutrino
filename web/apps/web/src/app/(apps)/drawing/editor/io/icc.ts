/**
 * Reading enough of an ICC profile to name it.
 *
 * Not a colour-management implementation — nothing here transforms a pixel. It
 * answers two questions the editor has to be able to answer about a file
 * somebody picked off their disk: **is this actually a profile**, and **what is
 * it called**. Without the first, "Embed ICC profile…" would accept a JPEG and
 * write it into every PNG the document exports; without the second, the panel
 * would have to show a file name, which is the one piece of metadata a profile
 * is least likely to be identified by.
 *
 * The layout is fixed by the specification: a 128-byte header, then a tag table
 * of `count · (signature, offset, size)`, then the tag data. The header's bytes
 * 36–40 are the signature `acsp`, which is what makes the format identifiable
 * at all; `desc` is the description tag, and it comes in two shapes because ICC
 * v4 replaced v2's ASCII record with a multi-localised Unicode one.
 */

export interface IccProfile {
  /** The profile's own description, or a fallback when it has none. */
  name: string;
  /** The data colour space: `RGB `, `GRAY`, `CMYK`, … as four characters. */
  colorSpace: string;
  /** Version major number, for the panel. */
  version: number;
  bytes: Uint8Array;
}

const HEADER_SIZE = 128;

function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * A profile, or null for bytes that are not one.
 *
 * The declared size is checked against the buffer as well as the signature: a
 * truncated profile passes the signature test and then produces tag offsets
 * that run off the end, and embedding one writes a chunk no decoder will read.
 */
export function parseIccProfile(bytes: Uint8Array): IccProfile | null {
  if (bytes.length < HEADER_SIZE + 4) return null;
  if (fourCC(bytes, 36) !== 'acsp') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(0, false);
  if (declared > bytes.length) return null;

  const colorSpace = fourCC(bytes, 16);
  const version = bytes[8];
  const name = readDescription(bytes, view) ?? `${colorSpace.trim()} profile`;
  return { name, colorSpace, version, bytes };
}

/** The `desc` tag, in whichever of its two encodings this profile uses. */
function readDescription(bytes: Uint8Array, view: DataView): string | null {
  const count = view.getUint32(HEADER_SIZE, false);
  // A tag table claiming thousands of entries is a corrupt file, not a rich
  // one; the bound stops a bad length turning into a long loop over garbage.
  if (count === 0 || count > 1024) return null;

  for (let i = 0; i < count; i++) {
    const entry = HEADER_SIZE + 4 + i * 12;
    if (entry + 12 > bytes.length) return null;
    if (fourCC(bytes, entry) !== 'desc') continue;

    const offset = view.getUint32(entry + 4, false);
    const size = view.getUint32(entry + 8, false);
    if (offset + size > bytes.length || size < 12) return null;

    const type = fourCC(bytes, offset);
    if (type === 'desc') {
      // ICC v2: a length that *includes* the terminating null.
      const length = view.getUint32(offset + 8, false);
      const start = offset + 12;
      const text = latin1(bytes, start, Math.max(0, Math.min(length - 1, size - 12)));
      return text || null;
    }
    if (type === 'mluc') {
      // ICC v4: records of (language, country, length, offset), UTF-16BE. The
      // first record is taken rather than matching a locale — this is a label
      // in a panel, and the alternative is a locale negotiation for a string
      // that is usually "sRGB IEC61966-2.1" in every language.
      const records = view.getUint32(offset + 8, false);
      if (records === 0) return null;
      const length = view.getUint32(offset + 20, false);
      const start = offset + view.getUint32(offset + 24, false);
      if (start + length > bytes.length) return null;
      return utf16be(bytes, start, length) || null;
    }
  }
  return null;
}

function latin1(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const byte = bytes[start + i];
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out.trim();
}

function utf16be(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = 0; i + 1 < length; i += 2) {
    const code = (bytes[start + i] << 8) | bytes[start + i + 1];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

/** A profile as the data URL the document stores it in. */
export function iccDataUrl(bytes: Uint8Array): string {
  let binary = '';
  // Chunked, because `String.fromCharCode(...bytes)` on a profile of a few
  // hundred kilobytes spreads that many arguments and overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:application/vnd.iccprofile;base64,${btoa(binary)}`;
}

/** The bytes back out of such a URL, or null when it is not one. */
export function iccBytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !/^data:application\/(vnd\.iccprofile|octet-stream);base64/i.test(dataUrl)) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
