import type { SearchableDocument, SearchResult } from './types';
import { tokenizeWithPositions, normalizeText } from './tokenizer';
import {
  openSearchDb,
  putTokenEntries,
  putDocEntry,
  deleteDocumentTokens,
  deleteTokenEntries,
  lookupPostings,
  getDocEntries,
  getAllDocEntries,
  type DocEntry,
  type TokenEntry,
} from './db';

const TITLE_WEIGHT = 3;
const MAX_RESULTS = 20;

/**
 * Query terms shorter than this are dropped rather than prefix-matched. A one
 * or two letter prefix matches a large share of the index, which costs a big
 * scan to return a result nobody wanted.
 */
const MIN_PREFIX_LENGTH = 3;

function positionsToBytes(positions: number[]): Uint8Array {
  const buf = new Uint8Array(positions.length * 4);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < positions.length; i++) {
    view.setUint32(i * 4, positions[i], true);
  }
  return buf;
}

function toTokenEntries(
  terms: { term: string; positions: number[] }[],
  documentId: string,
  field: 'title' | 'content',
): TokenEntry[] {
  return terms.map((t) => ({
    term: t.term,
    documentId,
    field,
    frequency: t.positions.length,
    positions: positionsToBytes(t.positions),
  }));
}

export class IndexEngine {
  private getDb: () => Promise<IDBDatabase>;

  constructor(dbFactory?: () => Promise<IDBDatabase>) {
    this.getDb = dbFactory ?? openSearchDb;
  }

  async indexDocument(doc: SearchableDocument): Promise<void> {
    const t0 = performance.now();
    const db = await this.getDb();
    await deleteDocumentTokens(doc.id, db);

    const titleTerms = tokenizeWithPositions(doc.title);
    const contentTerms = tokenizeWithPositions(doc.content);

    const entries = [
      ...toTokenEntries(titleTerms, doc.id, 'title'),
      ...toTokenEntries(contentTerms, doc.id, 'content'),
    ];

    await Promise.all([
      putTokenEntries(entries, db),
      putDocEntry(
        {
          documentId: doc.id,
          type: doc.type,
          title: doc.title,
          titleTerms: titleTerms.map((t) => t.term),
          contentTerms: contentTerms.map((t) => t.term),
          updatedAt: doc.updatedAt,
          mimeType: doc.mimeType,
        },
        db,
      ),
    ]);

    const elapsed = (performance.now() - t0).toFixed(1);
    const contentWords = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
    console.debug(
      `[search] indexed ${doc.type} "${doc.id}" — ` +
      `title terms: ${titleTerms.length}, content terms: ${contentTerms.length}, ` +
      `content words: ${contentWords}, total entries: ${entries.length}, ` +
      `${elapsed}ms`,
    );
  }

  async removeDocument(docId: string): Promise<void> {
    const db = await this.getDb();
    await deleteDocumentTokens(docId, db);
  }

  async updateDocument(doc: SearchableDocument): Promise<void> {
    const db = await this.getDb();
    const existing = (await getDocEntries([doc.id], db)).get(doc.id);

    if (!existing) {
      return this.indexDocument(doc);
    }

    const t0 = performance.now();
    const titleTerms = tokenizeWithPositions(doc.title);
    const contentTerms = tokenizeWithPositions(doc.content);

    const newTitleTerms = new Set(titleTerms.map((t) => t.term));
    const newContentTerms = new Set(contentTerms.map((t) => t.term));

    const removals: { term: string; field: 'title' | 'content' }[] = [];
    for (const term of existing.titleTerms ?? []) {
      if (!newTitleTerms.has(term)) removals.push({ term, field: 'title' });
    }
    for (const term of existing.contentTerms ?? []) {
      if (!newContentTerms.has(term)) removals.push({ term, field: 'content' });
    }

    const entries = [
      ...toTokenEntries(titleTerms, doc.id, 'title'),
      ...toTokenEntries(contentTerms, doc.id, 'content'),
    ];

    const elapsed = (performance.now() - t0).toFixed(1);
    console.debug(
      `[search] updated ${doc.type} "${doc.id}" — ` +
      `removed: ${removals.length}, upserted: ${entries.length}, ${elapsed}ms`,
    );

    await Promise.all([
      deleteTokenEntries(doc.id, removals, db),
      putTokenEntries(entries, db),
      putDocEntry({
        documentId: doc.id,
        type: doc.type,
        title: doc.title,
        titleTerms: [...newTitleTerms],
        contentTerms: [...newContentTerms],
        updatedAt: doc.updatedAt,
        mimeType: doc.mimeType,
      }, db),
    ]);
  }

  /**
   * Documents matching every term, where each term matches any indexed word it
   * is a prefix of — so "mod" finds "Modesto", and "mod bud" finds a document
   * with both a "mod…" and a "bud…" word.
   */
  async query(terms: string[]): Promise<SearchResult[]> {
    if (terms.length === 0) return [];
    const db = await this.getDb();

    const prefixes = terms
      .flatMap((t) => normalizeText(t))
      .filter((t) => t.length >= MIN_PREFIX_LENGTH);
    if (prefixes.length === 0) return [];

    const postingsMap = await lookupPostings(prefixes, db);

    // Intersect: a document must match every prefix, though any word starting
    // with that prefix satisfies it.
    let matchingDocIds: Set<string> | null = null;
    for (const prefix of prefixes) {
      const entries = postingsMap.get(prefix) ?? [];
      const docIdsForPrefix = new Set(entries.map((e) => e.documentId));
      if (matchingDocIds === null) {
        matchingDocIds = docIdsForPrefix;
      } else {
        for (const id of matchingDocIds) {
          if (!docIdsForPrefix.has(id)) matchingDocIds.delete(id);
        }
      }
    }

    const docIds = matchingDocIds ? [...matchingDocIds] : [];
    if (docIds.length === 0) return [];

    const docEntries = await getDocEntries(docIds, db);
    const matched = new Set(docIds);

    const scores = new Map<string, number>();
    for (const entries of postingsMap.values()) {
      for (const entry of entries) {
        if (!matched.has(entry.documentId)) continue;
        const weight = entry.field === 'title' ? TITLE_WEIGHT : 1;
        scores.set(
          entry.documentId,
          (scores.get(entry.documentId) ?? 0) + entry.frequency * weight,
        );
      }
    }

    return docIds
      .map((id) => {
        const doc = docEntries.get(id);
        return {
          docId: id,
          type: doc?.type ?? 'document',
          // Entries written before titles were stored fall back to the id;
          // the next index pass replaces them with the real title.
          title: doc?.title || id,
          score: scores.get(id) ?? 0,
          snippets: [],
          updatedAt: doc?.updatedAt ?? 0,
          mimeType: doc?.mimeType,
        } satisfies SearchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }

  /**
   * Everything currently in the index, keyed by document id. Callers diff this
   * against the server's listing to decide what to (re-)index and what to drop.
   */
  async listDocuments(): Promise<Map<string, DocEntry>> {
    const db = await this.getDb();
    return getAllDocEntries(db);
  }
}
