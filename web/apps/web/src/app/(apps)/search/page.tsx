'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Heading, Badge, SearchInput } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { IndexEngine, type SearchResult } from '@neutrino/search';
import { docTypeLabel, MIN_SEARCH_LENGTH } from '@/hooks/useClientSearch';
import styles from './page.module.css';

export default function SearchPage() {
  const user = useUser();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const engineRef = useRef<IndexEngine | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const kp = loadKeyPair(user.id);
    if (!kp) return;
    engineRef.current = new IndexEngine();
  }, [user?.id]);

  const handleSearch = useCallback(
    async (value: string) => {
      setQuery(value);
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
    [],
  );

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
