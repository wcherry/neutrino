import type { SearchableDocType } from './types';
import { emitSearchIndexUpdate } from './events';

const DB_NAME = 'neutrino_search';
/**
 * v2 replaced the hashed `tokenHash` key with the plain-text `term`, so that
 * prefix queries can range over it. A v1 database holds HMACs that cannot be
 * turned back into terms, so the upgrade drops both stores and the next sync
 * rebuilds them (see `CONTENT_VERSION` in the web app's `searchIndexer`).
 */
const DB_VERSION = 2;

export interface TokenEntry {
  /** The indexed word itself, lowercased and stripped of punctuation. */
  term: string;
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
  titleTerms: string[];
  contentTerms: string[];
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
      // Nothing in a v1 database survives the move off hashed keys, so start
      // clean rather than trying to migrate records whose terms are one-way.
      if (db.objectStoreNames.contains('tokens')) db.deleteObjectStore('tokens');
      if (db.objectStoreNames.contains('docs')) db.deleteObjectStore('docs');

      const tokenStore = db.createObjectStore('tokens', {
        keyPath: ['term', 'documentId', 'field'],
      });
      tokenStore.createIndex('byTerm', 'term', { unique: false });
      tokenStore.createIndex('byDocumentId', 'documentId', { unique: false });

      db.createObjectStore('docs', { keyPath: 'documentId' });
    };
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // `clearSearchIndex` deletes the whole database, and any connection still
      // open blocks that until it closes — including one this module has since
      // stopped tracking. Closing the connection itself (rather than whatever
      // `_db` currently points at) is what lets a rebuild or a snapshot import
      // go through; the next read reopens the fresh database.
      db.onversionchange = () => {
        db.close();
        if (_db === db) _db = null;
      };
      _db = db;
      _opening = null;
      resolve(db);
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
  removals: { term: string; field: 'title' | 'content' }[],
  db: IDBDatabase,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (removals.length === 0) {
      resolve();
      return;
    }
    const tx = db.transaction('tokens', 'readwrite');
    const store = tx.objectStore('tokens');
    for (const { term, field } of removals) {
      store.delete([term, docId, field]);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * No term can contain `￿` — `normalizeText` keeps only letters and
 * numbers — so it is a safe sentinel above every term sharing a prefix.
 */
const PREFIX_UPPER_BOUND = '￿';

/**
 * Postings for every term starting with each of `prefixes`, keyed by the prefix
 * that matched them.
 *
 * The range scan is what makes "mod" find "modesto": `byTerm` is ordered, so
 * IndexedDB walks straight to the first matching term and stops at the last,
 * without visiting the rest of the index.
 */
export function lookupPostings(
  prefixes: string[],
  db: IDBDatabase,
): Promise<Map<string, TokenEntry[]>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, TokenEntry[]>();
    if (prefixes.length === 0) {
      resolve(result);
      return;
    }
    const tx = db.transaction('tokens', 'readonly');
    const idx = tx.objectStore('tokens').index('byTerm');
    let pending = prefixes.length;

    for (const prefix of prefixes) {
      const req = idx.getAll(IDBKeyRange.bound(prefix, prefix + PREFIX_UPPER_BOUND));
      req.onsuccess = () => {
        result.set(prefix, (req.result as TokenEntry[]) ?? []);
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

/**
 * How many documents the index holds.
 *
 * Cheaper than `getAllDocEntries` — IndexedDB counts from the store's own
 * metadata rather than deserialising every record — because callers use this
 * only to answer "is there an index here at all?".
 */
export function countDocEntries(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('docs', 'readonly');
    const req = tx.objectStore('docs').count();
    req.onsuccess = () => resolve(req.result ?? 0);
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
    req.onsuccess = () => {
      // Announced from the delete itself: every caller here — rebuild, snapshot
      // import, "forget this device" — leaves readers holding results for
      // documents that no longer have entries.
      emitSearchIndexUpdate({ wholesale: true });
      resolve();
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // resolve anyway; stale tabs will clean up on reload
  });
}
