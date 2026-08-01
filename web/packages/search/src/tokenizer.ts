/**
 * Splitting text into the terms the index stores.
 *
 * Terms are kept as plain text. They used to be stored as
 * `HMAC-SHA256(term, searchKey)`, which made the index opaque at rest but also
 * made prefix search impossible: hashing is exactly the operation that destroys
 * the shared prefix between "mod" and "modesto", so `IDBKeyRange.bound` had
 * nothing to range over and every lookup had to be an exact-equality match.
 *
 * The hashing bought less than it appeared to — the key it used lived in
 * `localStorage` beside the user's E2EE keys, and document titles were already
 * stored in the clear next to the postings — so it was traded for a term index
 * the database can actually scan.
 */

const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;

/** Lowercased, punctuation-stripped words, deduplicated. */
export function normalizeText(text: string): string[] {
  return [...new Set(splitWords(text))];
}

function splitWords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_RE, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface TermWithPositions {
  term: string;
  positions: number[];
}

/**
 * Every distinct term in `text`, with the word offsets it appears at.
 *
 * Synchronous now that no crypto is involved; it used to have to await an HMAC
 * per term.
 */
export function tokenizeWithPositions(text: string): TermWithPositions[] {
  const words = splitWords(text);

  const positionMap = new Map<string, number[]>();
  for (let i = 0; i < words.length; i++) {
    const existing = positionMap.get(words[i]);
    if (existing) {
      existing.push(i);
    } else {
      positionMap.set(words[i], [i]);
    }
  }

  return [...positionMap].map(([term, positions]) => ({ term, positions }));
}
