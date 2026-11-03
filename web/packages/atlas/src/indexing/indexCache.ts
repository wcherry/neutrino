import { SPEC_VERSION } from '../parse';
import type { VaultStorage } from '../sync/vault';
import type { ExtractedPage } from './vaultIndex';

/**
 * Where an index cache is kept. Parsing is most of what building the index costs, and the web
 * parser takes seconds for a large vault, so the workspace keeps what it extracted from each
 * page and parses only the pages that changed since. The Mac app's parser is fast enough to
 * rebuild on every open; the cache is the web's alone.
 */
export interface IndexCacheStore {
  load(): Promise<Uint8Array | null>;
  save(data: Uint8Array): Promise<void>;
}

/**
 * The cache in a vault's own storage, beside its blobs: `IndexedDBStorage` seals it like
 * everything else, so it's as private as the pages it came from.
 */
export function storageIndexCache(storage: VaultStorage, key = 'index-cache'): IndexCacheStore {
  return { load: () => storage.read(key), save: (data) => storage.write(data, key) };
}

/** Bump when what's extracted from a page changes without the spec's version changing. */
const FORMAT = 1;

export type CachedPage = ExtractedPage & {
  /** The page's `Vault.contentTag` when it was extracted. */
  tag: string;
};

interface CacheFile {
  format: number;
  spec: string;
  pages: Record<string, CachedPage>;
}

export function encodeIndexCache(pages: Map<string, CachedPage>): Uint8Array {
  const file: CacheFile = { format: FORMAT, spec: SPEC_VERSION, pages: Object.fromEntries(pages) };
  return new TextEncoder().encode(JSON.stringify(file));
}

/** The cached pages, or none when the cache is missing, unreadable or from another format. */
export function decodeIndexCache(data: Uint8Array | null): Map<string, CachedPage> {
  if (!data) return new Map();
  try {
    const file = JSON.parse(new TextDecoder().decode(data)) as CacheFile;
    if (file.format !== FORMAT || file.spec !== SPEC_VERSION || typeof file.pages !== 'object') return new Map();
    return new Map(Object.entries(file.pages));
  } catch {
    return new Map();
  }
}
