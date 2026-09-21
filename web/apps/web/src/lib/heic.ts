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
 * 64 bytes rather than the box's own 12-byte minimum because the
 * compatible-brands list is open-ended — a camera that writes six of them
 * pushes the recognisable one past a tighter window, and this is now the only
 * signal consulted.
 */
async function sniffHeicBytes(blob: Blob): Promise<boolean> {
  // 4 (box size) + 4 ("ftyp") + 4 (major brand) + the compatible-brands list.
  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
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
 * True when `blob` is a HEIC/HEIF image, judged by the container's own `ftyp`
 * brands and by nothing else.
 *
 * **The bytes are the only signal, and that is the point.** Neither the file
 * name nor the declared mime type is consulted, for the same reason: both are
 * labels somebody attached, and a label that is wrong sends non-HEIC bytes into
 * libheif, which rejects them with an error about a missing HEIF image — the
 * least useful possible account of what went wrong.
 *
 * The name was always untrusted here (an edited HEIC is saved back as PNG bytes
 * under its original `.heic` name). The mime type turns out to be no better:
 * a Drive file's type is a server column a client wrote, and callers routinely
 * stamp it onto a blob whose contents they have not established — issue #32 was
 * an iOS-uploaded `.HEIC` whose *ciphertext* arrived here wearing `image/heic`,
 * so it was handed to the HEIC decoder and the real failure (the file never got
 * decrypted) was reported as a decode problem.
 *
 * Every HEIF file begins with an `ftyp` box, so nothing legitimate is lost by
 * refusing to guess.
 */
export async function isHeic(blob: Blob): Promise<boolean> {
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
