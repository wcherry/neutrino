import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openOfflineDb, STORE_NAME } from '../db';
import type { OfflineFileRecord } from '../db';
import {
  isFileCachedOffline,
  getOfflineCache,
  putOfflineCache,
  markDirtyWithPendingEdit,
  clearPendingEdit,
  removeOfflineCache,
} from '../cache';

function makeRecord(overrides: Partial<OfflineFileRecord> = {}): OfflineFileRecord {
  return {
    fileId: 'file-1',
    appType: 'docs',
    title: 'My Doc',
    encryptedContent: new TextEncoder().encode('ciphertext').buffer,
    dek: new Uint8Array(32).buffer,
    revision: 1,
    cachedAt: Date.now(),
    dirty: false,
    pendingContent: null,
    ...overrides,
  };
}

describe('@neutrino/offline cache', () => {
  beforeEach(async () => {
    // The db open connection is a module-level singleton (openOfflineDb),
    // so rather than deleting/reopening the whole database between tests
    // (which would block on the still-open prior connection), just clear
    // the object store's contents via a transaction.
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });

  it('reports not cached and null for a file that was never stored', async () => {
    expect(await isFileCachedOffline('missing')).toBe(false);
    expect(await getOfflineCache('missing')).toBeNull();
  });

  it('round-trips a record through put/get', async () => {
    const record = makeRecord();
    await putOfflineCache(record);

    expect(await isFileCachedOffline('file-1')).toBe(true);
    const fetched = await getOfflineCache('file-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.fileId).toBe('file-1');
    expect(fetched?.appType).toBe('docs');
    expect(fetched?.revision).toBe(1);
    expect(fetched?.dirty).toBe(false);
    expect(new Uint8Array(fetched!.encryptedContent)).toEqual(
      new Uint8Array(record.encryptedContent),
    );
  });

  it('upserts on put rather than throwing for an existing key', async () => {
    await putOfflineCache(makeRecord({ revision: 1 }));
    await putOfflineCache(makeRecord({ revision: 2, title: 'Renamed' }));

    const fetched = await getOfflineCache('file-1');
    expect(fetched?.revision).toBe(2);
    expect(fetched?.title).toBe('Renamed');
  });

  it('markDirtyWithPendingEdit sets dirty + pendingContent on an existing record', async () => {
    await putOfflineCache(makeRecord());
    const pending = {
      encryptedContent: new TextEncoder().encode('new-ciphertext').buffer,
      filename: 'doc.json',
    };

    await markDirtyWithPendingEdit('file-1', pending);

    const fetched = await getOfflineCache('file-1');
    expect(fetched?.dirty).toBe(true);
    expect(fetched?.pendingContent?.filename).toBe('doc.json');
    expect(new Uint8Array(fetched!.pendingContent!.encryptedContent)).toEqual(
      new Uint8Array(pending.encryptedContent),
    );
    // Untouched fields survive the partial update.
    expect(fetched?.revision).toBe(1);
  });

  it('markDirtyWithPendingEdit throws when no record exists yet', async () => {
    await expect(
      markDirtyWithPendingEdit('never-cached', {
        encryptedContent: new ArrayBuffer(0),
        filename: 'doc.json',
      }),
    ).rejects.toThrow(/no offline cache record/);
  });

  it('clearPendingEdit resets dirty and pendingContent to their clean state', async () => {
    await putOfflineCache(makeRecord());
    await markDirtyWithPendingEdit('file-1', {
      encryptedContent: new ArrayBuffer(4),
      filename: 'doc.json',
    });

    await clearPendingEdit('file-1');

    const fetched = await getOfflineCache('file-1');
    expect(fetched?.dirty).toBe(false);
    expect(fetched?.pendingContent).toBeNull();
  });

  it('clearPendingEdit throws when no record exists yet', async () => {
    await expect(clearPendingEdit('never-cached')).rejects.toThrow(
      /no offline cache record/,
    );
  });

  it('removeOfflineCache deletes the record', async () => {
    await putOfflineCache(makeRecord());
    expect(await isFileCachedOffline('file-1')).toBe(true);

    await removeOfflineCache('file-1');

    expect(await isFileCachedOffline('file-1')).toBe(false);
    expect(await getOfflineCache('file-1')).toBeNull();
  });

  it('removeOfflineCache is a no-op for a file that was never cached', async () => {
    await expect(removeOfflineCache('never-cached')).resolves.toBeUndefined();
  });
});
