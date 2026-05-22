'use client';

import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DictionaryDefinition {
  definition: string;
  example?: string;
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  meanings: DictionaryMeaning[];
}

export type DictionaryStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error';

export interface DictionaryLookupState {
  status: DictionaryStatus;
  word?: string;
  entry?: DictionaryEntry;
  /** Trigger a definition lookup for the given word. */
  lookup: (word: string) => void;
  /** Reset back to the idle state. */
  reset: () => void;
}

// ── Module-level cache ────────────────────────────────────────────────────────
// Cache results (including "not found" as null) so the same word is never
// fetched more than once per page session.

const resultCache = new Map<string, DictionaryEntry | null>();

// ── API call ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

async function fetchDefinition(word: string): Promise<DictionaryEntry | null> {
  const cached = resultCache.get(word);
  // `undefined` means not yet fetched; `null` means fetched but not found.
  if (cached !== undefined) return cached;

  const response = await fetch(`${API_BASE}/${encodeURIComponent(word)}`);

  if (response.status === 404) {
    resultCache.set(word, null);
    return null;
  }

  if (!response.ok) {
    throw new Error(`Dictionary API error: ${response.status}`);
  }

  const data: any[] = await response.json();
  const first = data[0];

  const entry: DictionaryEntry = {
    word: first.word as string,
    phonetic: (first.phonetic as string | undefined) ?? first.phonetics?.[0]?.text,
    meanings: (first.meanings ?? []).map(
          (m: any): DictionaryMeaning => ({
        partOfSpeech: m.partOfSpeech as string,
        definitions: (m.definitions ?? []).slice(0, 3).map(
                  (d: any): DictionaryDefinition => ({
            definition: d.definition as string,
            example: d.example as string | undefined,
          }),
        ),
      }),
    ),
  };

  resultCache.set(word, entry);
  return entry;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useDictionaryLookup
 *
 * Provides on-demand dictionary lookups via the free Dictionary API
 * (dictionaryapi.dev). Results are cached in memory for the page session so
 * the same word is never fetched twice.
 *
 * Usage:
 *   const { status, entry, lookup, reset } = useDictionaryLookup();
 *   lookup('hello');   // triggers fetch; status transitions idle → loading → found
 *   reset();           // returns to idle
 */
export function useDictionaryLookup(): DictionaryLookupState {
  const [status, setStatus] = useState<DictionaryStatus>('idle');
  const [word, setWord] = useState<string | undefined>(undefined);
  const [entry, setEntry] = useState<DictionaryEntry | undefined>(undefined);

  const lookup = useCallback((targetWord: string) => {
    setWord(targetWord);
    setEntry(undefined);

    // If already cached, resolve synchronously (next microtask).
    const cached = resultCache.get(targetWord);
    if (cached !== undefined) {
      setStatus(cached === null ? 'not-found' : 'found');
      setEntry(cached ?? undefined);
      return;
    }

    setStatus('loading');

    fetchDefinition(targetWord)
      .then((result) => {
        if (result === null) {
          setStatus('not-found');
        } else {
          setEntry(result);
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
    setEntry(undefined);
  }, []);

  return { status, word, entry, lookup, reset };
}
