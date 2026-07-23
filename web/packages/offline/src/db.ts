const DB_NAME = 'neutrino_offline';
const DB_VERSION = 1;
const STORE_NAME = 'files';

/**
 * A single cached doc/sheet file, opted into offline availability by the
 * user. Content is stored encrypted at rest — this module (and its sibling
 * `cache.ts`) never handles plaintext; callers are responsible for
 * encrypting/decrypting with `@neutrino/e2e-crypto` before/after storage.
 */
export interface OfflineFileRecord {
  fileId: string;
  appType: 'docs' | 'sheets';
  title: string;
  /** Same XChaCha20-Poly1305 ciphertext format the server stores. */
  encryptedContent: ArrayBuffer;
  /** Raw 32-byte DEK, cached so decrypt works with zero network. */
  dek: ArrayBuffer | null;
  /** Server's content_version as of the last successful sync. */
  revision: number;
  cachedAt: number;
  /** True when there's a local edit not yet confirmed on the server. */
  dirty: boolean;
  pendingContent: { encryptedContent: ArrayBuffer; filename: string } | null;
}

let _db: IDBDatabase | null = null;
let _opening: Promise<IDBDatabase> | null = null;

export function openOfflineDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };
    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      _opening = null;
      resolve(_db);
    };
    req.onerror = () => {
      _opening = null;
      reject(req.error);
    };
  });
  return _opening;
}

export function resetOfflineDb(): void {
  _db = null;
  _opening = null;
}

export { DB_NAME, STORE_NAME };
