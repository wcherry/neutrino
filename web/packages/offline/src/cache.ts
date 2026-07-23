import { openOfflineDb, STORE_NAME, type OfflineFileRecord } from './db';

/**
 * Public API for the offline file cache. Each function opens the IndexedDB
 * connection itself (mirroring `@neutrino/search`'s `IndexEngine`, which
 * resolves its own db via `openSearchDb` rather than requiring callers to
 * thread an `IDBDatabase` through) so callers never need to touch `db.ts`
 * directly.
 *
 * This module is a dumb storage layer: it never encrypts or decrypts
 * anything. Callers pass already-encrypted `ArrayBuffer`s in and get
 * already-encrypted `ArrayBuffer`s out.
 */

function getRecord(db: IDBDatabase, fileId: string): Promise<OfflineFileRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(fileId);
    req.onsuccess = () => resolve((req.result as OfflineFileRecord | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function putRecord(db: IDBDatabase, record: OfflineFileRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isFileCachedOffline(fileId: string): Promise<boolean> {
  const db = await openOfflineDb();
  const record = await getRecord(db, fileId);
  return record !== null;
}

export async function getOfflineCache(fileId: string): Promise<OfflineFileRecord | null> {
  const db = await openOfflineDb();
  return getRecord(db, fileId);
}

/** Upsert a cache record (put, not add — safe to call for both new and existing entries). */
export async function putOfflineCache(record: OfflineFileRecord): Promise<void> {
  const db = await openOfflineDb();
  return putRecord(db, record);
}

/**
 * Mark a cached file as dirty with a pending, not-yet-synced edit.
 * The file must already be opted into offline caching (i.e. `putOfflineCache`
 * must have been called for it at least once) — throws otherwise.
 */
export async function markDirtyWithPendingEdit(
  fileId: string,
  pendingContent: { encryptedContent: ArrayBuffer; filename: string },
): Promise<void> {
  const db = await openOfflineDb();
  const existing = await getRecord(db, fileId);
  if (!existing) {
    throw new Error(
      `markDirtyWithPendingEdit: no offline cache record for fileId "${fileId}" — the file must be opted into offline caching first`,
    );
  }
  await putRecord(db, { ...existing, dirty: true, pendingContent });
}

/** Clear a file's pending edit and dirty flag once it's been confirmed synced to the server. */
export async function clearPendingEdit(fileId: string): Promise<void> {
  const db = await openOfflineDb();
  const existing = await getRecord(db, fileId);
  if (!existing) {
    throw new Error(
      `clearPendingEdit: no offline cache record for fileId "${fileId}" — the file must be opted into offline caching first`,
    );
  }
  await putRecord(db, { ...existing, dirty: false, pendingContent: null });
}

/** Remove a file's offline cache entry entirely (e.g. the user disables offline availability). */
export async function removeOfflineCache(fileId: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
