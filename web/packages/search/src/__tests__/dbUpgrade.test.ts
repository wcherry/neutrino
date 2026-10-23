/**
 * v3 adds the `byUpdatedAt` index in place. A v2 index can hold thousands of documents a device
 * spent minutes fetching and decrypting, so the upgrade must keep them — unlike the v1 → v2 move,
 * which had to drop hashed terms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { clearSearchIndex, openSearchDb, resetSearchDb } from '../db';
import { indexFingerprint } from '../snapshot';

function openV2(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('neutrino_search', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tokens = db.createObjectStore('tokens', { keyPath: ['term', 'documentId', 'field'] });
      tokens.createIndex('byTerm', 'term', { unique: false });
      tokens.createIndex('byDocumentId', 'documentId', { unique: false });
      db.createObjectStore('docs', { keyPath: 'documentId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await clearSearchIndex();
  resetSearchDb();
});

describe('upgrading the search database from v2', () => {
  it('keeps every entry and adds the revision index', async () => {
    const v2 = await openV2();
    await new Promise<void>((resolve, reject) => {
      const tx = v2.transaction(['docs', 'tokens'], 'readwrite');
      tx.objectStore('docs').put({ documentId: 'a', type: 'document', title: 'A', titleTerms: ['a'], contentTerms: [], updatedAt: 5 });
      tx.objectStore('docs').put({ documentId: 'b', type: 'document', title: 'B', titleTerms: ['b'], contentTerms: [], updatedAt: 9 });
      tx.objectStore('tokens').put({ term: 'a', documentId: 'a', field: 'title', frequency: 1, positions: new Uint8Array(4) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    v2.close();

    const db = await openSearchDb();

    expect(db.version).toBe(3);
    expect([...db.transaction('docs').objectStore('docs').indexNames]).toContain('byUpdatedAt');
    expect(await indexFingerprint()).toEqual({ documents: 2, fingerprint: '2:1:9' });
  });
});
