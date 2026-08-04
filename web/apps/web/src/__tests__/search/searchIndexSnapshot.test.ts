/**
 * Tests for the encrypted snapshot exchange.
 *
 * The behaviours worth pinning down are the ones that lose data if they are
 * wrong: never uploading an empty index over a real one, never clobbering a
 * newer snapshot, and never echoing a freshly-pulled snapshot straight back.
 *
 * Crypto is mocked to an identity transform — libsodium's real behaviour is
 * covered by `@neutrino/e2e-crypto`'s own tests, and mocking it keeps these
 * assertions about the sync logic rather than about ciphertext.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadMock = vi.fn();
const getMetaMock = vi.fn();
const downloadMock = vi.fn();
const exportSnapshotMock = vi.fn();
const importSnapshotMock = vi.fn();
/**
 * How many documents the local IndexedDB index holds. Distinct from what
 * localStorage claims — the whole point of the check under test.
 */
const countDocumentsMock = vi.fn();

class FakeConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'FakeConflictError';
  }
}

vi.mock('@neutrino/api-search', () => ({
  searchSnapshotApi: {
    getMeta: (...a: unknown[]) => getMetaMock(...a),
    download: (...a: unknown[]) => downloadMock(...a),
    upload: (...a: unknown[]) => uploadMock(...a),
    remove: vi.fn(),
  },
  isSnapshotConflict: (e: unknown) => e instanceof FakeConflictError,
  isSnapshotMissing: () => false,
  SNAPSHOT_VERSION_CONFLICT: 'SNAPSHOT_VERSION_CONFLICT',
}));

vi.mock('@neutrino/search', () => ({
  IndexEngine: class {
    countDocuments = countDocumentsMock;
  },
  exportSnapshot: (...a: unknown[]) => exportSnapshotMock(...a),
  importSnapshot: (...a: unknown[]) => importSnapshotMock(...a),
  // Identity transforms: the sync layer only moves these bytes around.
  serializeSnapshot: (s: unknown) => new TextEncoder().encode(JSON.stringify(s)),
  deserializeSnapshot: (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn().mockResolvedValue(undefined),
  loadKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
  generateFileKey: () => new Uint8Array([9]),
  encryptFile: (plain: Uint8Array) => plain,
  decryptFile: (cipher: Uint8Array) => cipher,
  encryptFileKey: () => 'wrapped-key',
  decryptFileKey: () => new Uint8Array([9]),
}));

import {
  deviceId,
  forgetSyncedVersion,
  pullSnapshot,
  pushSnapshot,
  snapshotFingerprint,
  syncSnapshot,
} from '@/lib/searchIndexSnapshot';

const USER = 'user-1';

function makeSnapshot(docCount = 2, newest = 1_700_000_000_000) {
  return {
    format: 1,
    createdAt: 0,
    docs: Array.from({ length: docCount }, (_, i) => ({
      documentId: `doc-${i}`,
      type: 'document',
      title: `Doc ${i}`,
      titleTerms: ['doc'],
      contentTerms: ['body'],
      updatedAt: newest,
    })),
    tokens: [{ term: 'doc', documentId: 'doc-0', field: 'title', frequency: 1, positions: [0] }],
  };
}

function meta(version: number, device: string | null = 'other-device') {
  return {
    version,
    sizeBytes: 100,
    wrappedKey: 'wrapped-key',
    deviceId: device,
    updatedAt: '2026-08-03T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  forgetSyncedVersion(USER);
  exportSnapshotMock.mockResolvedValue(makeSnapshot());
  importSnapshotMock.mockImplementation(async (s: { docs: unknown[] }) => s.docs.length);
  uploadMock.mockResolvedValue(meta(1, deviceId()));
  getMetaMock.mockResolvedValue(null);
  downloadMock.mockResolvedValue(null);
  // Default: this device holds a populated index.
  countDocumentsMock.mockResolvedValue(5);
});

describe('pushSnapshot', () => {
  it('uploads the local index and remembers the version it produced', async () => {
    uploadMock.mockResolvedValue(meta(1, deviceId()));

    const result = await pushSnapshot(USER);

    expect(result).toMatchObject({ status: 'uploaded', version: 1, documents: 2 });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0][1]).toMatchObject({
      wrappedKey: 'wrapped-key',
      deviceId: deviceId(),
    });
  });

  it('claims first-upload when this device has never synced', async () => {
    await pushSnapshot(USER);
    expect(uploadMock.mock.calls[0][1].expectedVersion).toBeUndefined();
  });

  it('asserts the version it last saw on a subsequent upload', async () => {
    uploadMock.mockResolvedValue(meta(4, deviceId()));
    await pushSnapshot(USER);

    // A change to the index, so the fingerprint check does not skip the push.
    exportSnapshotMock.mockResolvedValue(makeSnapshot(3));
    await pushSnapshot(USER);

    expect(uploadMock.mock.calls[1][1].expectedVersion).toBe(4);
  });

  it('never replaces a stored snapshot with an empty index', async () => {
    // A device that has not built its index yet has nothing worth sharing, and
    // uploading it would wipe out every other device's search.
    exportSnapshotMock.mockResolvedValue(makeSnapshot(0));

    const result = await pushSnapshot(USER);

    expect(result.status).toBe('skipped');
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('skips the upload when the index has not changed since the last one', async () => {
    await pushSnapshot(USER);
    uploadMock.mockClear();

    const result = await pushSnapshot(USER);

    expect(result.status).toBe('skipped');
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('uploads again once the index actually changes', async () => {
    await pushSnapshot(USER);
    uploadMock.mockClear();
    exportSnapshotMock.mockResolvedValue(makeSnapshot(5));

    const result = await pushSnapshot(USER);

    expect(result.status).toBe('uploaded');
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('reports a conflict rather than retrying over the newer snapshot', async () => {
    uploadMock.mockRejectedValue(new FakeConflictError());

    const result = await pushSnapshot(USER);

    expect(result.status).toBe('conflict');
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('lets a non-conflict failure propagate', async () => {
    uploadMock.mockRejectedValue(new Error('network down'));
    await expect(pushSnapshot(USER)).rejects.toThrow('network down');
  });
});

describe('pullSnapshot', () => {
  it('reports nothing when the server holds no snapshot', async () => {
    getMetaMock.mockResolvedValue(null);
    const result = await pullSnapshot(USER);
    expect(result.status).toBe('none');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('imports a snapshot written by another device', async () => {
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));

    const result = await pullSnapshot(USER);

    expect(result).toMatchObject({ status: 'imported', version: 2, documents: 3 });
    expect(importSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it('skips downloading a snapshot this device wrote', async () => {
    getMetaMock.mockResolvedValue(meta(2, deviceId()));

    const result = await pullSnapshot(USER);

    expect(result.status).toBe('up-to-date');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('skips a version it has already imported', async () => {
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));
    await pullSnapshot(USER);
    downloadMock.mockClear();

    const result = await pullSnapshot(USER);

    expect(result.status).toBe('up-to-date');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  // ── Recovering a lost local index ─────────────────────────────────────────
  //
  // localStorage outlives IndexedDB: the object stores are dropped on a schema
  // upgrade, `rebuildSearchIndex` clears them before repopulating, and browsers
  // evict IndexedDB under quota pressure. In all of those the bookkeeping still
  // claims the device is current, so anything that decides from bookkeeping
  // alone leaves an empty index refusing the snapshot that would repair it.

  it('imports when the local index is empty even though the version matches', async () => {
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));

    // Bookkeeping says "already have version 2"...
    await pullSnapshot(USER);
    importSnapshotMock.mockClear();
    downloadMock.mockClear();

    // ...but the database behind it is gone.
    countDocumentsMock.mockResolvedValue(0);

    const result = await pullSnapshot(USER);

    expect(result).toMatchObject({ status: 'imported', version: 2, documents: 3 });
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  it('pulls back its own snapshot when the local index is gone', async () => {
    // The `deviceId` match means "this browser uploaded it", not "this browser
    // still holds it". A device that uploaded and then lost its index would
    // otherwise never recover from its own snapshot.
    const snapshot = makeSnapshot(4);
    getMetaMock.mockResolvedValue(meta(3, deviceId()));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));
    countDocumentsMock.mockResolvedValue(0);

    const result = await pullSnapshot(USER);

    expect(result).toMatchObject({ status: 'imported', version: 3, documents: 4 });
  });

  it('does not record a version it never imported', async () => {
    // The old bug was sticky rather than self-correcting: skipping the import
    // still wrote the version to localStorage, so the next pass skipped too.
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));
    countDocumentsMock.mockResolvedValue(0);

    await pullSnapshot(USER);
    importSnapshotMock.mockClear();

    // Still empty (say the import raced an eviction) — it must try again, not
    // consider itself current.
    countDocumentsMock.mockResolvedValue(0);
    const second = await pullSnapshot(USER);

    expect(second.status).toBe('imported');
    expect(importSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it('still skips redundant downloads once an index is actually present', async () => {
    // The empty-index escape hatch must not turn every sync into a download.
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));
    await pullSnapshot(USER);
    downloadMock.mockClear();

    const result = await pullSnapshot(USER);

    expect(result.status).toBe('up-to-date');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('handles the snapshot being deleted between the metadata read and download', async () => {
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(null);

    const result = await pullSnapshot(USER);

    expect(result.status).toBe('none');
    expect(importSnapshotMock).not.toHaveBeenCalled();
  });
});

describe('syncSnapshot', () => {
  it('does not echo a freshly-imported snapshot straight back to the server', async () => {
    // Without the fingerprint check every device would re-upload what it just
    // downloaded, bumping the version on every sync for no reason.
    const snapshot = makeSnapshot(3);
    getMetaMock.mockResolvedValue(meta(2));
    downloadMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot)));
    exportSnapshotMock.mockResolvedValue(snapshot);

    const { pull, push } = await syncSnapshot(USER);

    expect(pull.status).toBe('imported');
    expect(push.status).toBe('skipped');
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('pulls before pushing, so an upload cannot lose the remote index', async () => {
    const order: string[] = [];
    getMetaMock.mockImplementation(async () => {
      order.push('pull');
      return null;
    });
    uploadMock.mockImplementation(async () => {
      order.push('push');
      return meta(1, deviceId());
    });

    await syncSnapshot(USER);

    expect(order).toEqual(['pull', 'push']);
  });

  it('recovers from a race by pulling again and retrying the push once', async () => {
    uploadMock.mockRejectedValueOnce(new FakeConflictError());
    uploadMock.mockResolvedValue(meta(3, deviceId()));

    const { push } = await syncSnapshot(USER);

    expect(push.status).toBe('uploaded');
    expect(uploadMock).toHaveBeenCalledTimes(2);
    // Pulled once up front and once more after losing the race.
    expect(getMetaMock).toHaveBeenCalledTimes(2);
  });
});

describe('snapshotFingerprint', () => {
  it('changes when a document is added', () => {
    expect(snapshotFingerprint(makeSnapshot(2))).not.toBe(snapshotFingerprint(makeSnapshot(3)));
  });

  it('changes when a document is re-indexed with a newer revision', () => {
    expect(snapshotFingerprint(makeSnapshot(2, 1))).not.toBe(
      snapshotFingerprint(makeSnapshot(2, 2)),
    );
  });

  it('is stable for an unchanged index', () => {
    expect(snapshotFingerprint(makeSnapshot())).toBe(snapshotFingerprint(makeSnapshot()));
  });
});
