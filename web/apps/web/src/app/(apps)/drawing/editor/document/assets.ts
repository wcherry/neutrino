/**
 * Imported, linked and embedded assets.
 *
 * Redesign §5 asks a linked asset to carry its original URI, a UUID, a content
 * hash, its last-known dimensions and an embedded fallback copy. Four of those
 * are fields below. The fifth — **the embedded fallback copy — is the layer's
 * own pixels**, and that is the one decision worth reading before changing
 * anything here.
 *
 * A raster layer already holds a complete PNG data URL, and the `.ora` writer
 * already writes it to `data/layer-*.png`. Storing a second copy on the asset
 * would put the same megabytes in the document twice, in the manifest twice,
 * and in the archive twice, so that a document could say a thing it can already
 * demonstrate. So an asset is **provenance, not content**: where these pixels
 * came from, what they hashed to when they arrived, and how big they were, with
 * `RasterLayerNode.assetId` pointing back. The file stays viewable when the
 * external asset is unavailable because the pixels never depended on it.
 *
 * The hash is FNV-1a over the encoded bytes. It identifies — "is this still the
 * image I imported?" — and it does not authenticate; nothing here is a security
 * boundary, and a cryptographic digest would have made this module
 * asynchronous for no gain.
 */

import { newId } from './ids';

export interface LinkedAsset {
  id: string;
  /**
   * Where it came from, as given: a `https://…` link, a Drive reference, or the
   * bare file name for something picked off the disk. `linked` says whether
   * that URI can be fetched again.
   */
  uri: string;
  name: string;
  /** FNV-1a (32-bit) over the asset's bytes, as eight hex digits. */
  hash: string;
  /** The size it had when it was imported — what a re-fetch is checked against. */
  width: number;
  height: number;
  importedAt: string;
  /**
   * Whether the source can be reloaded. False for a local file, which the
   * browser cannot re-read without another file picker, and for anything
   * imported from bytes that were never at a URL.
   */
  linked: boolean;
}

/**
 * FNV-1a over a string, as eight hex digits.
 *
 * Run over the data URL's base64 body rather than over decoded bytes: the
 * base64 is what the document holds, decoding it would allocate a copy of every
 * asset to hash it, and the mapping is one-to-one either way.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, as shifts, because `hash * 16777619` loses precision above
    // 2^53 and JavaScript has no 32-bit multiply.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The bytes of a data URL — everything after the comma — or the whole string. */
export function dataUrlPayload(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function hashDataUrl(dataUrl: string): string {
  return hashString(dataUrlPayload(dataUrl));
}

export interface CreateAssetOptions {
  uri: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  /** Defaults to whether the URI is one a browser could fetch again. */
  linked?: boolean;
}

export function createAsset(options: CreateAssetOptions): LinkedAsset {
  // A `data:` URI *is* the image, and storing it here would put a second copy
  // of every embedded picture in the document — the exact duplication this
  // module exists to avoid. The name stands in for it, which is all a `data:`
  // source could ever have told anybody anyway.
  const uri = /^data:/i.test(options.uri) ? options.name : options.uri;
  return {
    id: newId(),
    uri,
    name: options.name,
    hash: hashDataUrl(options.dataUrl),
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
    importedAt: new Date().toISOString(),
    linked: options.linked ?? isReloadableUri(uri),
  };
}

/**
 * Whether a URI names something that can be fetched again.
 *
 * A `data:` URI is the bytes themselves, so re-fetching it can only ever return
 * what is already in the document — reloadable in the letter and pointless in
 * the spirit, which is why it is excluded rather than allowed through.
 */
export function isReloadableUri(uri: string): boolean {
  return /^(https?:|neutrino-drive:)/i.test(uri);
}

export function findAsset(assets: readonly LinkedAsset[] | undefined, id: string | undefined): LinkedAsset | null {
  if (!id) return null;
  return assets?.find((asset) => asset.id === id) ?? null;
}

/** Where an asset came from, phrased for the inspector. */
export function describeAssetSource(asset: LinkedAsset): string {
  if (/^neutrino-drive:/i.test(asset.uri)) return 'Neutrino Drive';
  const match = /^(https?):\/\/([^/]+)/i.exec(asset.uri);
  if (match) return match[2];
  return asset.linked ? asset.uri : 'Embedded copy';
}
