/**
 * zlib compression, from the platform.
 *
 * An `iCCP` chunk holds a **zlib datastream** — RFC 1950's two-byte header and
 * Adler-32 trailer around raw deflate — which is exactly what
 * `CompressionStream('deflate')` produces; `'deflate-raw'` is the one that
 * would be wrong, and the naming is close enough to be worth stating.
 *
 * Separated from `chunks.ts` so that everything about the *format* stays pure
 * and testable and only this one asynchronous, environment-dependent step is
 * behind a capability check. Where the API is missing — an older browser, jsdom
 * — the answer is null rather than a thrown error or a bundled compressor: the
 * profile still travels as its own archive entry and in the manifest, so what
 * is lost is the copy inside `mergedimage.png` and not the profile.
 */

export function canDeflate(): boolean {
  return typeof CompressionStream !== 'undefined';
}

export async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!canDeflate()) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}
