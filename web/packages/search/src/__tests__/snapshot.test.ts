/**
 * Snapshot serialisation round-trip.
 *
 * The snapshot is what a user's second device restores from, so the properties
 * that matter are that nothing is lost across export → encrypt → decrypt →
 * import, and that a restored index answers the same queries as the one it was
 * taken from. The subtle failure mode is `positions`: a packed `Uint8Array` in
 * IndexedDB that JSON turns into `{"0":12,...}` unless it is converted first,
 * producing an index that looks fine until something reads a position.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexEngine } from '../engine';
import { clearSearchIndex, openSearchDb, resetSearchDb } from '../db';
import {
  deserializeSnapshot,
  exportSnapshot,
  importSnapshot,
  serializeSnapshot,
  SNAPSHOT_FORMAT,
} from '../snapshot';

async function seedIndex() {
  const engine = new IndexEngine();
  await engine.indexDocument({
    id: 'doc-1',
    type: 'document',
    title: 'Project Budget',
    content: 'quarterly budget planning for the modesto office',
    updatedAt: 1_700_000_000_000,
  });
  await engine.indexDocument({
    id: 'file-1',
    type: 'file',
    title: 'invoice.pdf',
    content: '',
    updatedAt: 1_700_000_500_000,
    mimeType: 'application/pdf',
  });
  return engine;
}

beforeEach(async () => {
  await clearSearchIndex();
  resetSearchDb();
});

describe('exportSnapshot', () => {
  it('captures every document and posting in the index', async () => {
    await seedIndex();

    const snapshot = await exportSnapshot();

    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.docs.map((d) => d.documentId).sort()).toEqual(['doc-1', 'file-1']);
    expect(snapshot.tokens.length).toBeGreaterThan(0);
  });

  it('converts packed positions into plain numbers so JSON survives them', async () => {
    await seedIndex();

    const snapshot = await exportSnapshot();
    const token = snapshot.tokens.find((t) => t.term === 'budget' && t.field === 'content');

    expect(token).toBeDefined();
    expect(Array.isArray(token!.positions)).toBe(true);
    // The trap: a Uint8Array here would stringify to an object, not an array.
    const roundTripped = JSON.parse(JSON.stringify(token!.positions));
    expect(Array.isArray(roundTripped)).toBe(true);
    expect(roundTripped).toEqual(token!.positions);
  });

  it('is empty for an index that has never been built', async () => {
    const snapshot = await exportSnapshot();
    expect(snapshot.docs).toEqual([]);
    expect(snapshot.tokens).toEqual([]);
  });
});

describe('importSnapshot', () => {
  it('restores an index that answers the same queries', async () => {
    const engine = await seedIndex();
    const before = await engine.query(['budget']);
    const snapshot = await exportSnapshot();

    // Simulate the second device: nothing indexed locally.
    await clearSearchIndex();
    resetSearchDb();
    expect(await new IndexEngine().query(['budget'])).toEqual([]);

    const imported = await importSnapshot(snapshot);
    expect(imported).toBe(2);

    const after = await new IndexEngine().query(['budget']);
    expect(after.map((r) => r.docId)).toEqual(before.map((r) => r.docId));
    expect(after[0].title).toBe('Project Budget');
  });

  it('preserves prefix matching, which depends on terms staying plain text', async () => {
    await seedIndex();
    const snapshot = await exportSnapshot();
    await clearSearchIndex();
    resetSearchDb();
    await importSnapshot(snapshot);

    const results = await new IndexEngine().query(['mod']);
    expect(results.map((r) => r.docId)).toEqual(['doc-1']);
  });

  it('carries a file entry mimeType through, so results still link correctly', async () => {
    await seedIndex();
    const snapshot = await exportSnapshot();
    await clearSearchIndex();
    resetSearchDb();
    await importSnapshot(snapshot);

    const results = await new IndexEngine().query(['invoice']);
    expect(results[0].mimeType).toBe('application/pdf');
  });

  it('replaces the local index rather than merging into it', async () => {
    // A document the uploading device had already deleted must not survive the
    // import just because this device still has it.
    await seedIndex();
    const snapshot = await exportSnapshot();

    await clearSearchIndex();
    resetSearchDb();
    await new IndexEngine().indexDocument({
      id: 'stale-doc',
      type: 'note',
      title: 'Deleted Elsewhere',
      content: 'gone',
      updatedAt: 1,
    });

    await importSnapshot(snapshot);

    const ids = [...(await new IndexEngine().listDocuments()).keys()].sort();
    expect(ids).toEqual(['doc-1', 'file-1']);
  });

  it('refuses a snapshot written in a format it does not understand', async () => {
    await seedIndex();
    const snapshot = await exportSnapshot();

    await expect(
      importSnapshot({ ...snapshot, format: SNAPSHOT_FORMAT + 1 }),
    ).rejects.toThrow(/Unsupported search snapshot format/);
  });

  it('leaves the local index intact when the format is rejected', async () => {
    await seedIndex();
    const snapshot = await exportSnapshot();

    await importSnapshot({ ...snapshot, format: SNAPSHOT_FORMAT + 1 }).catch(() => {});

    const results = await new IndexEngine().query(['budget']);
    expect(results).toHaveLength(1);
  });
});

describe('serializeSnapshot / deserializeSnapshot', () => {
  it('round-trips through bytes, the form that gets encrypted', async () => {
    await seedIndex();
    const snapshot = await exportSnapshot();

    const bytes = serializeSnapshot(snapshot);
    // Not `toBeInstanceOf`: under jsdom `TextEncoder` returns a Uint8Array from
    // Node's realm, which fails an identity check against jsdom's global while
    // being the same thing everywhere it matters.
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const back = deserializeSnapshot(bytes);
    expect(back).toEqual(snapshot);
  });

  it('produces an index identical to the original after a byte round-trip', async () => {
    await seedIndex();
    const bytes = serializeSnapshot(await exportSnapshot());
    const expected = await openSearchDb().then(() => new IndexEngine().listDocuments());

    await clearSearchIndex();
    resetSearchDb();
    await importSnapshot(deserializeSnapshot(bytes));

    const restored = await new IndexEngine().listDocuments();
    expect([...restored.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [id, doc] of expected) {
      expect(restored.get(id)).toEqual(doc);
    }
  });
});
