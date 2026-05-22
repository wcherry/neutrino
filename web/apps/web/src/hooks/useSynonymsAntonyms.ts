'use client';

import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SynonymsAntonymsStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error';

export interface SynonymsAntonymsResult {
  synonyms: string[];
  antonyms: string[];
}

export interface SynonymsAntonymsState {
  status: SynonymsAntonymsStatus;
  word?: string;
  result?: SynonymsAntonymsResult;
  /** Trigger a lookup for the given word. */
  lookup: (word: string) => void;
  /** Reset back to idle state. */
  reset: () => void;
}

// ── Module-level cache ────────────────────────────────────────────────────────
// Cache results (including "not found" as null) so the same word is never
// fetched more than once per page session.

const resultCache = new Map<string, SynonymsAntonymsResult | null>();

// ── API call ──────────────────────────────────────────────────────────────────

const DATAMUSE_BASE = 'https://api.datamuse.com/words';
const MAX_WORDS = 8;

async function fetchWord(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Datamuse API error: ${response.status}`);
  }
  const data: { word: string }[] = await response.json();
  return data.slice(0, MAX_WORDS).map((item) => item.word);
}

async function fetchSynonymsAntonyms(word: string): Promise<SynonymsAntonymsResult | null> {
  const cached = resultCache.get(word);
  // `undefined` means not yet fetched; `null` means fetched but nothing found.
  if (cached !== undefined) return cached;

  const encodedWord = encodeURIComponent(word);
  const [synonyms, antonyms] = await Promise.all([
    fetchWord(`${DATAMUSE_BASE}?rel_syn=${encodedWord}`),
    fetchWord(`${DATAMUSE_BASE}?rel_ant=${encodedWord}`),
  ]);

  if (synonyms.length === 0 && antonyms.length === 0) {
    resultCache.set(word, null);
    return null;
  }

  const result: SynonymsAntonymsResult = { synonyms, antonyms };
  resultCache.set(word, result);
  return result;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useSynonymsAntonyms
 *
 * Provides on-demand synonym and antonym lookups via the free Datamuse API
 * (api.datamuse.com). Results are cached in memory for the page session so
 * the same word is never fetched twice.
 *
 * Up to 8 synonyms and 8 antonyms are returned per word.
 *
 * Usage:
 *   const { status, result, lookup, reset } = useSynonymsAntonyms();
 *   lookup('happy');   // triggers fetch; status: idle → loading → found/not-found
 *   reset();           // returns to idle
 */
export function useSynonymsAntonyms(): SynonymsAntonymsState {
  const [status, setStatus] = useState<SynonymsAntonymsStatus>('idle');
  const [word, setWord] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<SynonymsAntonymsResult | undefined>(undefined);

  const lookup = useCallback((targetWord: string) => {
    setWord(targetWord);
    setResult(undefined);

    // If already cached, resolve synchronously (next microtask).
    const cached = resultCache.get(targetWord);
    if (cached !== undefined) {
      setStatus(cached === null ? 'not-found' : 'found');
      setResult(cached ?? undefined);
      return;
    }

    setStatus('loading');

    fetchSynonymsAntonyms(targetWord)
      .then((fetched) => {
        if (fetched === null) {
          setStatus('not-found');
        } else {
          setResult(fetched);
          setStatus('found');
        }
      })
      .catch(() => {
        setStatus('error');
      });
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setWord(undefined);
    setResult(undefined);
  }, []);

  return { status, word, result, lookup, reset };
}
