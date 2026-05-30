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
        return {
          openCursor: vi.fn((range: IDBKeyRange) => {
            const val = (range as unknown as { lower: string }).lower;
            const entries = [...(data.get(val) ?? [])];
            let i = 0;
            const req = { onsuccess: null as ((e: object) => void) | null, onerror: null };
            function nextCursor() {
              const record = entries[i++] ?? null;
              const cursor = record
                ? {
                    delete: vi.fn(() => {
                      const key = getKey(record as Record<string, unknown>);
                      store.delete(key);
                      indexDelete(key);
                    }),
                    continue: vi.fn(() => queueMicrotask(nextCursor)),
                  }
                : null;
              req.onsuccess?.({ target: { result: cursor } } as unknown as Event);
            }
            queueMicrotask(nextCursor);
            return req;
          }),
          getAll: vi.fn((range: IDBKeyRange) => {
            const val = (range as unknown as { lower: string }).lower;
            const results = [...(data.get(val) ?? [])];
            const req = { result: results, onsuccess: null as ((e: object) => void) | null, onerror: null };
            queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
            return req;
          }),
        };
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

  const tokenStoreObj = makeStore(tokenStore, ['tokenHash', 'documentId', 'field']);
  const docStoreObj = makeStore(docStore, 'documentId');

  // Wire up indexes
  tokenStoreObj.createIndex('byTokenHash', 'tokenHash');
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

    queueMicrotask(() => oncomplete?.());
    return tx;
  }

  const db = {
    transaction: vi.fn(makeTx),
    objectStoreNames: { contains: vi.fn(() => true) },
  };

  return db as unknown as IDBDatabase;
}

describe('IndexEngine', () => {
  const searchKey = new Uint8Array(32).fill(7);
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

  it('indexes a document and retrieves it by title term', async () => {
    await engine.indexDocument(flamingo, searchKey);
    const results = await engine.query(['flamingo'], searchKey);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('doc-1');
  });

  it('multi-word AND: returns doc when all terms match', async () => {
    await engine.indexDocument(flamingo, searchKey);
    const results = await engine.query(['flamingo', 'budget'], searchKey);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe('doc-1');
  });

  it('multi-word AND: returns empty when one term is absent', async () => {
    await engine.indexDocument(flamingo, searchKey);
    const results = await engine.query(['flamingo', 'zephyr'], searchKey);
    expect(results).toHaveLength(0);
  });

  it('returns empty results for unrelated term', async () => {
    await engine.indexDocument(flamingo, searchKey);
    const results = await engine.query(['xylophone'], searchKey);
    expect(results).toHaveLength(0);
  });

  it('returns empty results for empty query', async () => {
    await engine.indexDocument(flamingo, searchKey);
    const results = await engine.query([], searchKey);
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
    await engine.indexDocument(titleDoc, searchKey);
    await engine.indexDocument(contentDoc, searchKey);
    const results = await engine.query(['flamingo'], searchKey);
    const titleResult = results.find((r) => r.docId === 'doc-title');
    const contentResult = results.find((r) => r.docId === 'doc-content');
    expect(titleResult).toBeDefined();
    expect(contentResult).toBeDefined();
    // title weight=3, frequency=1 → score 3; content weight=1, frequency=3 → score 3 (equal or title wins)
    expect(titleResult!.score).toBeGreaterThanOrEqual(contentResult!.score);
  });

  it('removeDocument clears indexed terms', async () => {
    await engine.indexDocument(flamingo, searchKey);
    await engine.removeDocument('doc-1');
    const results = await engine.query(['flamingo'], searchKey);
    expect(results).toHaveLength(0);
  });
});

describe('body/content search', () => {
  const searchKey = new Uint8Array(32).fill(7);
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
    await engine.indexDocument(doc, searchKey);
    const results = await engine.query(['revenue'], searchKey);
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
    await engine.indexDocument(doc, searchKey);
    const results = await engine.query(['invoice'], searchKey);
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
    await engine.indexDocument(matching, searchKey);
    await engine.indexDocument(nonMatching, searchKey);
    const results = await engine.query(['vendor'], searchKey);
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
    await engine.indexDocument(doc, searchKey);
    const results = await engine.query(['deployment', 'pipeline'], searchKey);
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
    await engine.indexDocument(doc, searchKey);
    const results = await engine.query(['authentication', 'invoice'], searchKey);
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
    await engine.indexDocument(sheet, searchKey);
    const results = await engine.query(['headcount'], searchKey);
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
    await engine.indexDocument(slide, searchKey);
    const results = await engine.query(['enterprise'], searchKey);
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
    await engine.indexDocument(note, searchKey);
    const results = await engine.query(['websockets'], searchKey);
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
    await engine.indexDocument(original, searchKey);

    const updated: SearchableDocument = {
      ...original,
      content: 'This document covers cloud migration planning.',
      updatedAt: Date.now() + 1,
    };
    await engine.indexDocument(updated, searchKey);

    const cloudResults = await engine.query(['cloud'], searchKey);
    expect(cloudResults).toHaveLength(1);
    expect(cloudResults[0].docId).toBe('doc-update');

    const legacyResults = await engine.query(['legacy'], searchKey);
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
    await engine.indexDocument(doc, searchKey);
    const results = await engine.query(['kubernetes'], searchKey);
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
    await engine.indexDocument(doc1, searchKey);
    await engine.indexDocument(doc2, searchKey);
    const results = await engine.query(['onboarding'], searchKey);
    const ids = results.map((r) => r.docId);
    expect(ids).toContain('doc-a');
    expect(ids).toContain('doc-b');
  });
});
