/**
 * Image bytes for `writeDocx`.
 *
 * `write.ts` cannot reach Drive — it is a pure model→bytes function, which is
 * what makes it testable without a network — so resolving what an image `src`
 * actually points at happens here and the result is handed in as a map.
 *
 * Three kinds of `src` reach this, and all three end as bytes in the package:
 * a `neutrino-drive:` reference (downloaded and decrypted by `driveImages.ts`,
 * the only place holding the key), a `data:` URL, and an ordinary http(s) URL.
 * Anything that fails is simply absent from the map, and `imageRun` writes a
 * placeholder for it rather than a broken picture — one unreachable image must
 * not take the save down with it, because a save that throws is a save the
 * document does not get.
 */

import { resolveDriveImageDataUrl } from '@/lib/driveImages';
import type { DocModel, DocNode } from './mapping';

/** Every distinct image `src` in the document, in no particular order. */
export function imageSources(model: DocModel): string[] {
  const found = new Set<string>();
  const walk = (node: DocNode): void => {
    if (node.type === 'image') {
      const src = String(node.attrs?.src ?? '');
      if (src) found.add(src);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(model.doc);
  return [...found];
}

function bytesFromDataUrl(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (!/;base64/i.test(head)) {
    // A `data:image/svg+xml,<svg …>` URL — percent-encoded text, not base64.
    return new TextEncoder().encode(decodeURIComponent(body));
  }
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function bytesFor(src: string): Promise<Uint8Array | null> {
  if (src.startsWith('data:')) return bytesFromDataUrl(src);

  if (src.startsWith('neutrino-drive:')) {
    const dataUrl = await resolveDriveImageDataUrl(src.slice('neutrino-drive:'.length));
    return bytesFromDataUrl(dataUrl);
  }

  if (/^https?:/i.test(src)) {
    // Subject to CORS, like every other cross-origin read the browser does for
    // us. A host that refuses one leaves the image as a placeholder, which is
    // the same outcome the image picker's URL tab reports at insert time.
    const res = await fetch(src);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  return null;
}

/**
 * `src` → bytes for every image in `model`, ready to pass as
 * `WriteDocxOptions.images`.
 *
 * Resolved concurrently and never rejects: a source that cannot be read is left
 * out of the map.
 */
export async function collectImageBytes(model: DocModel): Promise<Map<string, Uint8Array>> {
  const sources = imageSources(model);
  if (sources.length === 0) return new Map();

  const resolved = await Promise.all(
    sources.map(async (src) => {
      try {
        return [src, await bytesFor(src)] as const;
      } catch {
        return [src, null] as const;
      }
    }),
  );

  const out = new Map<string, Uint8Array>();
  for (const [src, bytes] of resolved) {
    if (bytes && bytes.length > 0) out.set(src, bytes);
  }
  return out;
}
