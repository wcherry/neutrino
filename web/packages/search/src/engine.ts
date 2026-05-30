import type { SearchableDocument, SearchResult } from './types';
import { tokenizeWithPositions, normalizeText, hashToken } from './tokenizer';
import {
  openSearchDb,
  putTokenEntries,
  putDocEntry,
  deleteDocumentTokens,
  lookupPostings,
  getDocEntries,
  type TokenEntry,
} from './db';

const TITLE_WEIGHT = 3;
const MAX_RESULTS = 20;

function positionsToBytes(positions: number[]): Uint8Array {
  const buf = new Uint8Array(positions.length * 4);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < positions.length; i++) {
    view.setUint32(i * 4, positions[i], true);
  }
  return buf;
}

export class IndexEngine {
  private getDb: () => Promise<IDBDatabase>;

  constructor(dbFactory?: () => Promise<IDBDatabase>) {
    this.getDb = dbFactory ?? openSearchDb;
  }

  async indexDocument(doc: SearchableDocument, searchKey: Uint8Array): Promise<void> {
    const t0 = performance.now();
    const db = await this.getDb();
    await deleteDocumentTokens(doc.id, db);

    const [titleTokens, contentTokens] = await Promise.all([
      tokenizeWithPositions(doc.title, searchKey),
      tokenizeWithPositions(doc.content, searchKey),
    ]);

    const entries: TokenEntry[] = [
      ...titleTokens.map((t) => ({
        tokenHash: t.hash,
        documentId: doc.id,
        field: 'title' as const,
        frequency: t.positions.length,
        positions: positionsToBytes(t.positions),
      })),
      ...contentTokens.map((t) => ({
        tokenHash: t.hash,
        documentId: doc.id,
        field: 'content' as const,
        frequency: t.positions.length,
        positions: positionsToBytes(t.positions),
      })),
    ];

    const titleHashes = titleTokens.map((t) => t.hash);

    await Promise.all([
      putTokenEntries(entries, db),
      putDocEntry({ documentId: doc.id, type: doc.type, titleHashes, updatedAt: doc.updatedAt }, db),
    ]);

    const elapsed = (performance.now() - t0).toFixed(1);
    const contentWords = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
    console.debug(
      `[search] indexed ${doc.type} "${doc.id}" — ` +
      `title tokens: ${titleTokens.length}, content tokens: ${contentTokens.length}, ` +
      `content words: ${contentWords}, total entries: ${entries.length}, ` +
      `${elapsed}ms`,
    );
  }

  async removeDocument(docId: string): Promise<void> {
    const db = await this.getDb();
    await deleteDocumentTokens(docId, db);
  }

  async query(terms: string[], searchKey: Uint8Array): Promise<SearchResult[]> {
    if (terms.length === 0) return [];
    const db = await this.getDb();

    const normalizedTerms = terms.flatMap((t) => normalizeText(t));
    if (normalizedTerms.length === 0) return [];

    const termHashes = await Promise.all(normalizedTerms.map((t) => hashToken(t, searchKey)));

    const postingsMap = await lookupPostings(termHashes, db);

    // intersect: only docIds appearing in ALL term hashes
    let matchingDocIds: Set<string> | null = null;
    for (const hash of termHashes) {
      const entries = postingsMap.get(hash) ?? [];
      const docIdsForHash = new Set(entries.map((e) => e.documentId));
      if (matchingDocIds === null) {
        matchingDocIds = docIdsForHash;
      } else {
        for (const id of matchingDocIds) {
          if (!docIdsForHash.has(id)) matchingDocIds.delete(id);
        }
      }
    }

    const docIds = matchingDocIds ? [...matchingDocIds] : [];
    if (docIds.length === 0) return [];

    const docEntries = await getDocEntries(docIds, db);

    const scores = new Map<string, number>();
    for (const entries of postingsMap.values()) {
      for (const entry of entries) {
        if (!docIds.includes(entry.documentId)) continue;
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
          title: id,
          score: scores.get(id) ?? 0,
          snippets: [],
        } satisfies SearchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }
}
