import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  emitSearchIndexUpdate,
  resetSearchIndexEvents,
  subscribeToSearchIndexUpdates,
  type SearchIndexUpdate,
} from '../events';
import { IndexEngine } from '../engine';
import { clearSearchIndex, resetSearchDb } from '../db';
import { exportSnapshot, importSnapshot } from '../snapshot';
import type { SearchableDocument } from '../types';

const CHANNEL_NAME = 'neutrino:search-index';

describe('search index events', () => {
  beforeEach(() => {
    resetSearchIndexEvents();
  });

  afterEach(() => {
    resetSearchIndexEvents();
    vi.useRealTimers();
  });

  describe('delivery', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('notifies subscribers after the coalescing window', () => {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));

      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      expect(seen).toHaveLength(0);

      vi.runAllTimers();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ documentIds: ['doc-1'], wholesale: false, local: true });
    });

    it('merges the ids emitted within one window into a single update', () => {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));

      // What a rebuild looks like: one write per document, back to back.
      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      emitSearchIndexUpdate({ documentIds: ['doc-2'] });
      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      vi.runAllTimers();

      expect(seen).toHaveLength(1);
      expect(seen[0].documentIds.sort()).toEqual(['doc-1', 'doc-2']);
    });

    it('reports a wholesale change without ids, however it was batched', () => {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));

      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      emitSearchIndexUpdate({ wholesale: true });
      vi.runAllTimers();

      expect(seen).toHaveLength(1);
      expect(seen[0].wholesale).toBe(true);
      // The listed ids would be a lie: every entry in the index changed.
      expect(seen[0].documentIds).toEqual([]);
    });

    it('starts a fresh batch after a flush', () => {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));

      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      vi.runAllTimers();
      emitSearchIndexUpdate({ documentIds: ['doc-2'] });
      vi.runAllTimers();

      expect(seen.map((u) => u.documentIds)).toEqual([['doc-1'], ['doc-2']]);
    });

    it('stops delivering once unsubscribed', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeToSearchIndexUpdates(listener);

      unsubscribe();
      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      vi.runAllTimers();

      expect(listener).not.toHaveBeenCalled();
    });

    it('still notifies the other subscribers when one throws', () => {
      const good = vi.fn();
      subscribeToSearchIndexUpdates(() => {
        throw new Error('subscriber blew up');
      });
      subscribeToSearchIndexUpdates(good);

      emitSearchIndexUpdate({ documentIds: ['doc-1'] });
      vi.runAllTimers();

      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe('across tabs', () => {
    // Guarded rather than skipped outright: the channel is optional everywhere
    // (server rendering has none), and the rest of the bus works without it.
    const available = typeof BroadcastChannel !== 'undefined';

    it.runIf(available)('hears about a change made in another tab', async () => {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));

      // Stands in for the tab that did the indexing.
      const other = new BroadcastChannel(CHANNEL_NAME);
      other.postMessage({ documentIds: ['doc-9'], wholesale: false, at: Date.now() });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      other.close();

      expect(seen[0]).toMatchObject({ documentIds: ['doc-9'], wholesale: false });
      // The flag readers use to tell their own writes from someone else's.
      expect(seen[0].local).toBe(false);
    });

    it.runIf(available)('broadcasts what it flushes', async () => {
      const other = new BroadcastChannel(CHANNEL_NAME);
      const received: unknown[] = [];
      other.onmessage = (event) => received.push(event.data);

      subscribeToSearchIndexUpdates(() => {});
      emitSearchIndexUpdate({ wholesale: true });

      await vi.waitFor(() => expect(received).toHaveLength(1));
      other.close();

      expect(received[0]).toMatchObject({ wholesale: true, documentIds: [] });
    });
  });

  /**
   * The point of the bus: no way of changing the index may leave readers
   * holding results taken from the version before it.
   */
  describe('write paths announce themselves', () => {
    const doc: SearchableDocument = {
      id: 'doc-1',
      type: 'document',
      title: 'Flamingo Budget',
      content: 'habitat funding for the quarter',
      updatedAt: 1_700_000_000_000,
    };

    async function nextUpdate(act: () => Promise<unknown>): Promise<SearchIndexUpdate> {
      const seen: SearchIndexUpdate[] = [];
      subscribeToSearchIndexUpdates((u) => seen.push(u));
      await act();
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      return seen[seen.length - 1];
    }

    beforeEach(async () => {
      await clearSearchIndex();
      resetSearchDb();
      resetSearchIndexEvents();
    });

    it('names the document an index write touched', async () => {
      const engine = new IndexEngine();
      const update = await nextUpdate(() => engine.indexDocument(doc));
      expect(update).toMatchObject({ documentIds: ['doc-1'], wholesale: false });
    });

    it('names the document an update touched', async () => {
      const engine = new IndexEngine();
      await engine.indexDocument(doc);
      resetSearchIndexEvents();

      const update = await nextUpdate(() =>
        engine.updateDocument({ ...doc, content: 'revised funding note' }),
      );
      expect(update).toMatchObject({ documentIds: ['doc-1'], wholesale: false });
    });

    it('names the document a removal dropped', async () => {
      const engine = new IndexEngine();
      await engine.indexDocument(doc);
      resetSearchIndexEvents();

      const update = await nextUpdate(() => engine.removeDocument('doc-1'));
      expect(update).toMatchObject({ documentIds: ['doc-1'], wholesale: false });
    });

    it('reports clearing the index as wholesale', async () => {
      const engine = new IndexEngine();
      await engine.indexDocument(doc);
      resetSearchIndexEvents();

      const update = await nextUpdate(() => clearSearchIndex());
      expect(update.wholesale).toBe(true);
    });

    it('announces an imported snapshot once its entries are readable', async () => {
      const engine = new IndexEngine();
      await engine.indexDocument(doc);
      const snapshot = await exportSnapshot();
      resetSearchDb();
      resetSearchIndexEvents();

      let documentsAtNotify = -1;
      const update = await nextUpdate(async () => {
        // Import's own clear fires first; what matters is that by the time the
        // last event lands, the index actually holds the snapshot.
        await importSnapshot(snapshot);
        documentsAtNotify = await new IndexEngine().countDocuments();
      });

      expect(update.wholesale).toBe(true);
      expect(documentsAtNotify).toBe(1);
    });
  });
});
