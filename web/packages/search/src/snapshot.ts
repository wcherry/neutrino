/**
 * Whole-index serialisation, for syncing the search index between a user's
 * devices.
 *
 * The index is expensive to build — every document has to be fetched and
 * decrypted — so a second device would otherwise repeat that work from nothing.
 * `exportSnapshot` flattens both object stores into one JSON-able structure the
 * caller encrypts and uploads; `importSnapshot` replaces the local index with a
 * decrypted one.
 *
 * The snapshot is plaintext terms, matching what the local index stores (see
 * `db.ts` on why v2 moved off hashed keys). It is never written to disk or sent
 * anywhere in this form: the caller encrypts it first, and the server only ever
 * holds ciphertext.
 */

import {
  openSearchDb,
  clearSearchIndex,
  type DocEntry,
  type TokenEntry,
} from './db';
import { emitSearchIndexUpdate } from './events';

/**
 * Bumped when the snapshot's shape changes. A device reading a snapshot it does
 * not understand ignores it and keeps its own index rather than importing
 * garbage — its next upload replaces the snapshot with a current one.
 */
export const SNAPSHOT_FORMAT = 1;

/**
 * One posting, with `positions` as a plain number array. The stored form is a
 * packed `Uint8Array`, which does not survive `JSON.stringify` — it serialises
 * to `{"0":12,"1":0,...}` and comes back as an object, silently producing an
 * index whose positions are unreadable.
 */
export interface SnapshotToken {
  term: string;
  documentId: string;
  field: 'title' | 'content';
  frequency: number;
  positions: number[];
}

export interface IndexSnapshot {
  format: number;
  /** When the snapshot was taken, epoch millis. */
  createdAt: number;
  docs: DocEntry[];
  tokens: SnapshotToken[];
}

function bytesToPositions(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 4 <= bytes.byteLength; i += 4) {
    out.push(view.getUint32(i, true));
  }
  return out;
}

function positionsToBytes(positions: number[]): Uint8Array {
  const buf = new Uint8Array(positions.length * 4);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < positions.length; i++) {
    view.setUint32(i * 4, positions[i], true);
  }
  return buf;
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** The whole local index, ready to be encrypted and uploaded. */
export async function exportSnapshot(): Promise<IndexSnapshot> {
  const db = await openSearchDb();
  const [docs, tokens] = await Promise.all([
    getAll<DocEntry>(db, 'docs'),
    getAll<TokenEntry>(db, 'tokens'),
  ]);

  return {
    format: SNAPSHOT_FORMAT,
    createdAt: Date.now(),
    docs,
    tokens: tokens.map((t) => ({
      term: t.term,
      documentId: t.documentId,
      field: t.field,
      frequency: t.frequency,
      positions: bytesToPositions(t.positions),
    })),
  };
}

/**
 * Replace the local index with `snapshot`.
 *
 * The existing index is dropped first rather than merged: the snapshot is a
 * complete picture, and keeping local entries alongside it would resurrect
 * documents the uploading device had already seen deleted.
 *
 * Returns the number of documents imported.
 */
export async function importSnapshot(snapshot: IndexSnapshot): Promise<number> {
  if (snapshot.format !== SNAPSHOT_FORMAT) {
    throw new Error(
      `Unsupported search snapshot format ${snapshot.format} (this client reads ${SNAPSHOT_FORMAT})`,
    );
  }

  await clearSearchIndex();
  const db = await openSearchDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['docs', 'tokens'], 'readwrite');
    const docStore = tx.objectStore('docs');
    const tokenStore = tx.objectStore('tokens');
    for (const doc of snapshot.docs) {
      docStore.put(doc);
    }
    for (const token of snapshot.tokens) {
      tokenStore.put({
        term: token.term,
        documentId: token.documentId,
        field: token.field,
        frequency: token.frequency,
        positions: positionsToBytes(token.positions),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  // `clearSearchIndex` above has already announced the drop, but that fires
  // while this index is still empty. Listeners re-read as soon as they hear,
  // so the import needs its own event once the entries are actually there.
  emitSearchIndexUpdate({ wholesale: true });

  return snapshot.docs.length;
}

/** UTF-8 bytes of a snapshot, the input to encryption. */
export function serializeSnapshot(snapshot: IndexSnapshot): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

/** Inverse of `serializeSnapshot`, applied to decrypted bytes. */
export function deserializeSnapshot(bytes: Uint8Array): IndexSnapshot {
  return JSON.parse(new TextDecoder().decode(bytes)) as IndexSnapshot;
}
