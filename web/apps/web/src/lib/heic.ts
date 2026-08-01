/**
 * HEIC/HEIF support.
 *
 * Apple's HEIC container is what iPhones shoot by default, but no browser
 * except Safari can decode it in an `<img>` / `createImageBitmap`. Photos are
 * end-to-end encrypted, so the server never sees the plaintext and can't
 * transcode for us — the conversion has to happen client-side, after decryption.
 *
 * `heic-to` (libheif compiled to wasm) is ~1.5 MB, so it is only ever pulled in
 * via dynamic import, and only for files that actually sniff as HEIC.
 */

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

// ISO-BMFF brands that indicate HEIF-family content. `mif1`/`msf1` are the
// generic HEIF brands; the rest are the HEVC-coded variants Apple writes.
const HEIC_FTYP_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
]);

/**
 * Reads the ISO-BMFF `ftyp` box brands from the head of a blob.
 *
 * Browsers are unreliable about HEIC mime types — a file picker on Linux or an
 * older Android will hand back `''` or `application/octet-stream` — so the
 * bytes are the only trustworthy signal.
 */
async function sniffHeicBytes(blob: Blob): Promise<boolean> {
  // 4 (box size) + 4 ("ftyp") + 4 (major brand) + up to 4 compatible brands
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (header.length < 12) return false;

  const ascii = (offset: number) =>
    String.fromCharCode(header[offset], header[offset + 1], header[offset + 2], header[offset + 3]);

  if (ascii(4) !== 'ftyp') return false;

  // Major brand, then the compatible-brands list that fills the rest of the box.
  const boxSize = Math.min(new DataView(header.buffer).getUint32(0), header.length);
  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    if (HEIC_FTYP_BRANDS.has(ascii(offset))) return true;
  }
  return false;
}

/**
 * True when `blob` is a HEIC/HEIF image, judged by its declared mime type or
 * the container's own `ftyp` brands.
 *
 * The file *name* is deliberately not consulted: an edited HEIC is saved back
 * as PNG bytes while keeping its original `.heic` name, and trusting the
 * extension there would send a PNG through the HEIC decoder.
 */
export async function isHeic(blob: Blob): Promise<boolean> {
  if (HEIC_MIME_TYPES.has(blob.type.toLowerCase())) return true;
  // Always fall through to the bytes: callers routinely hand us a blob whose
  // declared type was defaulted to something generic upstream.
  return sniffHeicBytes(blob);
}

/**
 * Decodes a HEIC blob to PNG so it can be used as an `<img>` source or drawn
 * to a canvas. Throws if the file cannot be decoded.
 */
export async function heicToPng(blob: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to');
  return heicTo({ blob, type: 'image/png' });
}

/**
 * Converts `blob` to PNG when it is HEIC, and returns it untouched otherwise.
 * Use this on any blob that is about to be handed to the browser's image
 * decoder.
 */
export async function toRenderableImageBlob(blob: Blob): Promise<Blob> {
  if (!(await isHeic(blob))) return blob;
  return heicToPng(blob);
}
