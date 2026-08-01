import type { SearchableDocType } from './types';

const DB_NAME = 'neutrino_search';
const DB_VERSION = 1;

export interface TokenEntry {
  tokenHash: string;
  documentId: string;
  field: 'title' | 'content';
  frequency: number;
  positions: Uint8Array;
}

export interface DocEntry {
  documentId: string;
  type: SearchableDocType;
  /**
   * Display title, kept in the clear. The local index never leaves the device
   * as-is: the sync path (see `agent_docs/search.md`) encrypts the whole
   * database before uploading it, so results can be rendered without a second
   * round-trip to the server.
   */
  title: string;
  titleHashes: string[];
  contentHashes: string[];
  updatedAt: number;
  /** Drive mimetype for `file` entries; absent for in-app documents. */
  mimeType?: string;
}

let _db: IDBDatabase | null = null;
let _opening: Promise<IDBDatabase> | null = null;

export function openSearchDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('tokens')) {
        const tokenStore = db.createObjectStore('tokens', {
          keyPath: ['tokenHash', 'documentId', 'field'],
        });
        tokenStore.createIndex('byTokenHash', 'tokenHash', { unique: false });
        tokenStore.createIndex('byDocumentId', 'documentId', { unique: false });
      }
      if (!db.objectStoreNames.contains('docs')) {
        db.createObjectStore('docs', { keyPath: 'documentId' });
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

export function putTokenEntries(entries: TokenEntry[], db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tokens', 'readwrite');
    const store = tx.objectStore('tokens');
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function putDocEntry(entry: DocEntry, db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteDocumentTokens(docId: string, db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tokens', 'docs'], 'readwrite');
    const tokenStore = tx.objectStore('tokens');
    const idx = tokenStore.index('byDocumentId');
    const req = idx.openCursor(IDBKeyRange.only(docId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.objectStore('docs').delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteTokenEntries(
  docId: string,
  removals: { hash: string; field: 'title' | 'content' }[],
  db: IDBDatabase,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (removals.length === 0) {
      resolve();
      return;
    }
    const tx = db.transaction('tokens', 'readwrite');
    const store = tx.objectStore('tokens');
    for (const { hash, field } of removals) {
      store.delete([hash, docId, field]);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function lookupPostings(
  tokenHashes: string[],
  db: IDBDatabase,
): Promise<Map<string, TokenEntry[]>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, TokenEntry[]>();
    if (tokenHashes.length === 0) {
      resolve(result);
      return;
    }
    const tx = db.transaction('tokens', 'readonly');
    const idx = tx.objectStore('tokens').index('byTokenHash');
    let pending = tokenHashes.length;

    for (const hash of tokenHashes) {
      const req = idx.getAll(IDBKeyRange.only(hash));
      req.onsuccess = () => {
        result.set(hash, (req.result as TokenEntry[]) ?? []);
        pending--;
        if (pending === 0) resolve(result);
      };
      req.onerror = () => reject(req.error);
    }
    tx.onerror = () => reject(tx.error);
  });
}

export function getDocEntries(
  docIds: string[],
  db: IDBDatabase,
): Promise<Map<string, DocEntry>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, DocEntry>();
    if (docIds.length === 0) {
      resolve(result);
      return;
    }
    const tx = db.transaction('docs', 'readonly');
    const store = tx.objectStore('docs');
    let pending = docIds.length;
    for (const id of docIds) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) result.set(id, req.result as DocEntry);
        pending--;
        if (pending === 0) resolve(result);
      };
      req.onerror = () => reject(req.error);
    }
    tx.onerror = () => reject(tx.error);
  });
}

/** Every indexed document, keyed by id — used to diff the index against the server. */
export function getAllDocEntries(db: IDBDatabase): Promise<Map<string, DocEntry>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('docs', 'readonly');
    const req = tx.objectStore('docs').getAll();
    req.onsuccess = () => {
      const entries = (req.result as DocEntry[]) ?? [];
      resolve(new Map(entries.map((e) => [e.documentId, e])));
    };
    req.onerror = () => reject(req.error);
  });
}

export function resetSearchDb(): void {
  _db = null;
  _opening = null;
}

export function clearSearchIndex(): Promise<void> {
  if (_db) {
    _db.close();
    _db = null;
  }
  _opening = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // resolve anyway; stale tabs will clean up on reload
  });
}
