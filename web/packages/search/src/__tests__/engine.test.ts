import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexEngine } from '../engine';
import type { SearchableDocument } from '../types';

// jsdom doesn't polyfill IDBKeyRange — provide a minimal shim
if (typeof globalThis.IDBKeyRange === 'undefined') {
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: {
      only: (value: unknown) => ({ lower: value, upper: value, lowerOpen: false, upperOpen: false }),
      lowerBound: (lower: unknown, open = false) => ({ lower, lowerOpen: open }),
      upperBound: (upper: unknown, open = false) => ({ upper, upperOpen: open }),
      bound: (lower: unknown, upper: unknown, lo = false, uo = false) => ({ lower, upper, lowerOpen: lo, upperOpen: uo }),
    },
    writable: true,
  });
}

// Minimal in-memory IndexedDB mock
function createMockDb() {
  const tokenStore = new Map<string, object>();
  const docStore = new Map<string, object>();

  /**
   * Cursor walks still in flight. A real transaction doesn't complete until its
   * requests finish; without tracking that, `oncomplete` fires on the first
   * microtask and a caller awaiting the transaction resumes before the cursor
   * has deleted anything.
   */
  const pending = { count: 0 };

  function makeStore(store: Map<string, object>, keyPath: string | string[]) {
    // index name → { fieldName, data }
    const indexRegistry = new Map<string, { fieldName: string; data: Map<string, object[]> }>();

    function getKey(record: Record<string, unknown>): string {
      if (Array.isArray(keyPath)) {
        return keyPath.map((k) => String(record[k])).join('|');
      }
      return String(record[keyPath as string]);
    }

    function indexPut(record: Record<string, unknown>, compositeKey: string) {
      for (const { fieldName, data } of indexRegistry.values()) {
        const val = String(record[fieldName]);
        if (!data.has(val)) data.set(val, []);
        const arr = data.get(val)!;
        const idx = arr.findIndex((r) => getKey(r as Record<string, unknown>) === compositeKey);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
      }
    }

    function indexDelete(compositeKey: string) {
      for (const { data } of indexRegistry.values()) {
        for (const [k, arr] of data.entries()) {
          data.set(k, arr.filter((r) => getKey(r as Record<string, unknown>) !== compositeKey));
        }
      }
    }

    const storeObj = {
      put: vi.fn((record: Record<string, unknown>) => {
        const key = getKey(record);
        store.set(key, record);
        indexPut(record, key);
        return { onsuccess: null, onerror: null };
      }),
      get: vi.fn((id: string) => {
        const req = { result: store.get(id) ?? null, onsuccess: null as ((e: object) => void) | null, onerror: null };
        queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
        return req;
      }),
      delete: vi.fn((id: string) => {
        const key = String(id);
        store.delete(key);
        indexDelete(key);
        return { onsuccess: null };
      }),
      index: vi.fn((name: string) => {
        const entry = indexRegistry.get(name);
        const data = entry?.data ?? new Map<string, object[]>();

        /**
         * Records whose indexed value falls inside `range`, mirroring how
         * IndexedDB walks an ordered index. `IDBKeyRange.only` arrives here as
         * lower === upper, so exact lookups fall out of the same code — and a
         * prefix bound picks up every term sharing that prefix.
         */
        function inRange(range: IDBKeyRange): object[] {
          const { lower, upper, lowerOpen, upperOpen } = range as unknown as {
            lower: string; upper: string; lowerOpen: boolean; upperOpen: boolean;
          };
          const keys = [...data.keys()].sort();
          const matched: object[] = [];
          for (const k of keys) {
            if (lower !== undefined && (lowerOpen ? k <= lower : k < lower)) continue;
            if (upper !== undefined && (upperOpen ? k >= upper : k > upper)) continue;
            matched.push(...(data.get(k) ?? []));
          }
          return matched;
        }

        return {
          openCursor: vi.fn((range: IDBKeyRange) => {
            const entries = inRange(range);
            let i = 0;
            const req = { onsuccess: null as ((e: object) => void) | null, onerror: null };
            pending.count++;
            function nextCursor() {
              const record = entries[i++] ?? null;
              if (!record) {
                pending.count--;
                req.onsuccess?.({ target: { result: null } } as unknown as Event);
                return;
              }
              const cursor = {
                delete: vi.fn(() => {
                  const key = getKey(record as Record<string, unknown>);
                  store.delete(key);
                  indexDelete(key);
                }),
                continue: vi.fn(() => queueMicrotask(nextCursor)),
              };
              req.onsuccess?.({ target: { result: cursor } } as unknown as Event);
            }
            queueMicrotask(nextCursor);
            return req;
          }),
          getAll: vi.fn((range: IDBKeyRange) => {
            const req = { result: inRange(range), onsuccess: null as ((e: object) => void) | null, onerror: null };
            queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
            return req;
          }),
        };
      }),
      getAll: vi.fn(() => {
        const req = { result: [...store.values()], onsuccess: null as ((e: object) => void) | null, onerror: null };
        queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
        return req;
      }),
      createIndex: vi.fn((name: string, fieldName: string) => {
        if (!indexRegistry.has(name)) {
          const data = new Map<string, object[]>();
          // seed from existing store entries
          for (const record of store.values()) {
            const r = record as Record<string, unknown>;
            const val = String(r[fieldName]);
            if (!data.has(val)) data.set(val, []);
            data.get(val)!.push(record);
          }
          indexRegistry.set(name, { fieldName, data });
        }
        return storeObj;
      }),
    };
    return storeObj;
  }

  const tokenStoreObj = makeStore(tokenStore, ['term', 'documentId', 'field']);
  const docStoreObj = makeStore(docStore, 'documentId');

  // Wire up indexes
  tokenStoreObj.createIndex('byTerm', 'term');
  tokenStoreObj.createIndex('byDocumentId', 'documentId');

  function makeTx(_storeNames: string[], _mode: string) {
    const stores: Record<string, typeof tokenStoreObj> = {
      tokens: tokenStoreObj,
      docs: docStoreObj,
    };

    let oncomplete: (() => void) | null = null;
    let onerror: ((e: unknown) => void) | null = null;

    const tx = {
      objectStore: vi.fn((name: string) => stores[name]),
      set oncomplete(cb: (() => void) | null) { oncomplete = cb; },
      set onerror(cb: ((e: unknown) => void) | null) { onerror = cb; },
    };

    // Wait for in-flight cursor walks before reporting the transaction done.
    function settle() {
      if (pending.count > 0) queueMicrotask(settle);
      else oncomplete?.();
    }
    queueMicrotask(settle);
    return tx;
  }

  const db = {
    transaction: vi.fn(makeTx),
    objectStoreNames: { contains: vi.fn(() => true) },
  };

  return db as unknown as IDBDatabase;
}

describe('IndexEngine', () => {
  let engine: IndexEngine;

  beforeEach(() => {
    const db = createMockDb();
    engine = new IndexEngine(() => Promise.resolve(db));
  });

  const flamingo: SearchableDocument = {
    id: 'doc-1',
    type: 'document',
    title: 'Flamingo Budget Report',
    content: 'This report covers flamingo habitat funding and budget allocation for 2025.',
    updatedAt: Date.now(),
  };

  it('matches a prefix of a title word', async () => {
    await engine.indexDocument({ ...flamingo, title: 'Modesto Trip' });
    const results = await engine.query(['mod']);
    expect(results.map((r) => r.docId)).toEqual(['doc-1']);
  });

  it('matches a prefix of a body word', async () => {
    await engine.indexDocument({
      ...flamingo,
      title: 'Untitled document',
      content: 'Notes from the Modesto office',
    });
    const results = await engine.query(['mod']);
    expect(results.map((r) => r.docId)).toEqual(['doc-1']);
  });

  it('matches the whole word too, not only shorter prefixes', async () => {
    await engine.indexDocument({ ...flamingo, title: 'Modesto Trip' });
    expect(await engine.query(['modesto'])).toHaveLength(1);
  });

  it('does not match a suffix or an interior fragment', async () => {
    // Prefix search only — a range scan can't reach words by their middle.
    await engine.indexDocument({ ...flamingo, title: 'Modesto Trip' });
    expect(await engine.query(['desto'])).toHaveLength(0);
    expect(await engine.query(['esto'])).toHaveLength(0);
  });

  it('requires every term to prefix-match some word', async () => {
    await engine.indexDocument({ ...flamingo, title: 'Modesto Budget' });
    expect(await engine.query(['mod', 'bud'])).toHaveLength(1);
    expect(await engine.query(['mod', 'zep'])).toHaveLength(0);
  });

  it('ignores terms too short to prefix-match, rather than scanning the index', async () => {
    await engine.indexDocument({ ...flamingo, title: 'Modesto Trip' });
    expect(await engine.query(['mo'])).toHaveLength(0);
    // A short term alongside a usable one is dropped, not treated as a miss.
    expect(await engine.query(['mo', 'modesto'])).toHaveLength(1);
  });

  it('counts one document once when several of its words share the prefix', async () => {
    await engine.indexDocument({
      ...flamingo,
      title: 'Modesto',
      content: 'modern models modelling',
    });
    const results = await engine.query(['mod']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('doc-1');
  });

  it('stops a prefix at its own range — "budget" must not match "bud"-only docs', async () => {
    await engine.indexDocument({ ...flamingo, id: 'doc-bud', title: 'Buddy List', content: '' });
    await engine.indexDocument({ ...flamingo, id: 'doc-budget', title: 'Budget Plan', content: '' });
    const results = await engine.query(['budget']);
    expect(results.map((r) => r.docId)).toEqual(['doc-budget']);
  });

  it('indexes a document and retrieves it by title term', async () => {
    await engine.indexDocument(flamingo);
    const results = await engine.query(['flamingo']);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('doc-1');
  });

  it('multi-word AND: returns doc when all terms match', async () => {
    await engine.indexDocument(flamingo);
    const results = await engine.query(['flamingo', 'budget']);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('doc-1');
  });

  it('multi-word AND: returns empty when one term is absent', async () => {
    await engine.indexDocument(flamingo);
    const results = await engine.query(['flamingo', 'zephyr']);
    expect(results).toHaveLength(0);
  });

  it('returns empty results for unrelated term', async () => {
    await engine.indexDocument(flamingo);
    const results = await engine.query(['xylophone']);
    expect(results).toHaveLength(0);
  });

  it('returns empty results for empty query', async () => {
    await engine.indexDocument(flamingo);
    const results = await engine.query([]);
    expect(results).toHaveLength(0);
  });

  it('title hits score higher than content-only hits', async () => {
    const titleDoc: SearchableDocument = {
      id: 'doc-title',
      type: 'note',
      title: 'flamingo notes',
      content: 'nothing relevant here',
      updatedAt: Date.now(),
    };
    const contentDoc: SearchableDocument = {
      id: 'doc-content',
      type: 'note',
      title: 'random title',
      content: 'flamingo flamingo flamingo',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(titleDoc);
    await engine.indexDocument(contentDoc);
    const results = await engine.query(['flamingo']);
    const titleResult = results.find((r) => r.docId === 'doc-title');
    const contentResult = results.find((r) => r.docId === 'doc-content');
    expect(titleResult).toBeDefined();
    expect(contentResult).toBeDefined();
    // title weight=3, frequency=1 → score 3; content weight=1, frequency=3 → score 3 (equal or title wins)
    expect(titleResult!.score).toBeGreaterThanOrEqual(contentResult!.score);
  });

  it('returns the document title and last-changed date, not the raw id', async () => {
    await engine.indexDocument(flamingo);
    const [result] = await engine.query(['flamingo']);
    expect(result.title).toBe('Flamingo Budget Report');
    expect(result.updatedAt).toBe(flamingo.updatedAt);
  });

  it('re-indexing updates the stored title', async () => {
    await engine.indexDocument(flamingo);
    await engine.indexDocument({ ...flamingo, title: 'Flamingo Budget Report v2' });
    const [result] = await engine.query(['flamingo']);
    expect(result.title).toBe('Flamingo Budget Report v2');
  });

  it('updateDocument keeps the stored title in sync', async () => {
    await engine.indexDocument(flamingo);
    await engine.updateDocument(
      { ...flamingo, title: 'Renamed Flamingo Report', updatedAt: flamingo.updatedAt + 1 });
    const [result] = await engine.query(['flamingo']);
    expect(result.title).toBe('Renamed Flamingo Report');
  });

  it('listDocuments reports what is currently indexed', async () => {
    await engine.indexDocument(flamingo);
    const docs = await engine.listDocuments();
    expect(docs.get('doc-1')).toMatchObject({
      documentId: 'doc-1',
      type: 'document',
      title: 'Flamingo Budget Report',
      updatedAt: flamingo.updatedAt,
    });
  });

  it('removeDocument clears indexed terms', async () => {
    await engine.indexDocument(flamingo);
    await engine.removeDocument('doc-1');
    const results = await engine.query(['flamingo']);
    expect(results).toHaveLength(0);
  });
});

describe('body/content search', () => {
  let engine: IndexEngine;

  beforeEach(() => {
    const db = createMockDb();
    engine = new IndexEngine(() => Promise.resolve(db));
  });

  it('finds a document when the search term appears only in the body', async () => {
    const doc: SearchableDocument = {
      id: 'doc-body-only',
      type: 'document',
      title: 'Untitled',
      content: 'The quarterly revenue figures show significant growth in APAC markets.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc);
    const results = await engine.query(['revenue']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('doc-body-only');
  });

  it('does not return a document when the term is absent from both title and body', async () => {
    const doc: SearchableDocument = {
      id: 'doc-no-match',
      type: 'document',
      title: 'Meeting Notes',
      content: 'We discussed the roadmap and team capacity for next quarter.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc);
    const results = await engine.query(['invoice']);
    expect(results).toHaveLength(0);
  });

  it('returns only the document whose body contains the term', async () => {
    const matching: SearchableDocument = {
      id: 'doc-match',
      type: 'document',
      title: 'Project Alpha',
      content: 'Budget constraints require renegotiating vendor contracts.',
      updatedAt: Date.now(),
    };
    const nonMatching: SearchableDocument = {
      id: 'doc-no-match',
      type: 'note',
      title: 'Personal Note',
      content: 'Reminder to water the plants.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(matching);
    await engine.indexDocument(nonMatching);
    const results = await engine.query(['vendor']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('doc-match');
  });

  it('matches a multi-word AND query where both terms appear only in the body', async () => {
    const doc: SearchableDocument = {
      id: 'doc-multi',
      type: 'document',
      title: 'Weekly Sync',
      content: 'The deployment pipeline failed due to a missing environment variable.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc);
    const results = await engine.query(['deployment', 'pipeline']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('doc-multi');
  });

  it('returns empty when one term of a multi-word query is missing from the body', async () => {
    const doc: SearchableDocument = {
      id: 'doc-partial',
      type: 'document',
      title: 'Tech Debt',
      content: 'Refactoring the authentication module will improve reliability.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc);
    const results = await engine.query(['authentication', 'invoice']);
    expect(results).toHaveLength(0);
  });

  it('finds a spreadsheet document by body content', async () => {
    const sheet: SearchableDocument = {
      id: 'sheet-1',
      type: 'spreadsheet',
      title: 'Q3 Data',
      content: 'Revenue Expenses Profit Headcount',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(sheet);
    const results = await engine.query(['headcount']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('sheet-1');
    expect(results[0].type).toBe('spreadsheet');
  });

  it('finds a slide document by body content', async () => {
    const slide: SearchableDocument = {
      id: 'slide-1',
      type: 'slide',
      title: 'Q4 Roadmap',
      content: 'Our go-to-market strategy focuses on enterprise customers in Europe.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(slide);
    const results = await engine.query(['enterprise']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('slide-1');
    expect(results[0].type).toBe('slide');
  });

  it('finds a note document by body content', async () => {
    const note: SearchableDocument = {
      id: 'note-1',
      type: 'note',
      title: 'Quick Thought',
      content: 'Consider using WebSockets for the real-time collaboration feature.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(note);
    const results = await engine.query(['websockets']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('note-1');
  });

  it('re-indexing with updated body makes new term searchable and old term unsearchable', async () => {
    const original: SearchableDocument = {
      id: 'doc-update',
      type: 'document',
      title: 'Living Doc',
      content: 'This document covers legacy infrastructure.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(original);

    const updated: SearchableDocument = {
      ...original,
      content: 'This document covers cloud migration planning.',
      updatedAt: Date.now() + 1,
    };
    await engine.indexDocument(updated);

    const cloudResults = await engine.query(['cloud']);
    expect(cloudResults).toHaveLength(1);
    expect(cloudResults[0].docId).toBe('doc-update');

    const legacyResults = await engine.query(['legacy']);
    expect(legacyResults).toHaveLength(0);
  });

  it('body search is case-insensitive', async () => {
    const doc: SearchableDocument = {
      id: 'doc-case',
      type: 'document',
      title: 'Notes',
      content: 'The KUBERNETES cluster needs to be upgraded to version 1.30.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc);
    const results = await engine.query(['kubernetes']);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('doc-case');
  });

  it('returns multiple documents when both have the search term in their body', async () => {
    const doc1: SearchableDocument = {
      id: 'doc-a',
      type: 'document',
      title: 'Alpha',
      content: 'The onboarding checklist needs to be updated.',
      updatedAt: Date.now(),
    };
    const doc2: SearchableDocument = {
      id: 'doc-b',
      type: 'note',
      title: 'Beta',
      content: 'New hire onboarding starts next Monday.',
      updatedAt: Date.now(),
    };
    await engine.indexDocument(doc1);
    await engine.indexDocument(doc2);
    const results = await engine.query(['onboarding']);
    const ids = results.map((r) => r.docId);
    expect(ids).toContain('doc-a');
    expect(ids).toContain('doc-b');
  });
});
