'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Heading, Badge, SearchInput } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { IndexEngine, type SearchResult } from '@neutrino/search';
import { docTypeLabel, MIN_SEARCH_LENGTH } from '@/hooks/useClientSearch';
import { useSearchIndexUpdates } from '@/hooks/useSearchIndexUpdates';
import styles from './page.module.css';

export default function SearchPage() {
  const user = useUser();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const engineRef = useRef<IndexEngine | null>(null);
  /** The query the results belong to, for re-running it when the index moves. */
  const queryRef = useRef('');

  // Switching user invalidates an engine built for the previous one.
  useEffect(() => {
    engineRef.current = null;
  }, [user?.id]);

  const handleSearch = useCallback(
    async (value: string) => {
      setQuery(value);
      queryRef.current = value;

      // Built here rather than in a mount effect, the way the topbar's
      // `useClientSearch` does it. `loadKeyPair` reads the *in-memory* session
      // keyring, which is unlocked asynchronously from IndexedDB after the
      // page mounts — so a mount-time check loses the race on a fresh load,
      // and with nothing to retry it the engine stayed null and every query on
      // this page returned nothing at all. Checking per search means the first
      // query after the keyring lands builds it.
      const userId = user?.id;
      if (userId && !engineRef.current && loadKeyPair(userId)) {
        engineRef.current = new IndexEngine();
      }
      const engine = engineRef.current;

      // Terms are prefix-matched, so a one or two letter query would scan a
      // large slice of the index — the same floor the topbar search uses.
      if (!engine || value.trim().length < MIN_SEARCH_LENGTH) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const terms = value.trim().split(/\s+/).filter(Boolean);
        const found = await engine.query(terms);
        setResults(found);
      } finally {
        setSearching(false);
      }
    },
    [user?.id],
  );

  // Editors index as they save, and the sync and snapshot pull rewrite whole
  // swathes of the index — none of which this page would otherwise notice.
  useSearchIndexUpdates(() => {
    if (queryRef.current.trim()) void handleSearch(queryRef.current);
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1}>Search</Heading>
        <SearchInput
          placeholder="Search across your documents, notes, sheets…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label="Search"
        />
      </div>

      {query.trim() && !searching && results.length === 0 && (
        <p className={styles.empty}>No results for &ldquo;{query}&rdquo;</p>
      )}

      {results.length > 0 && (
        <ul className={styles.results} role="list">
          {results.map((r) => (
            <li key={r.docId} className={styles.resultItem} data-testid="search-result">
              <span className={styles.resultTitle}>{r.title || r.docId}</span>
              <div className={styles.resultMeta}>
                <Badge>{docTypeLabel(r.type)}</Badge>
                <span>Score: {r.score}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
