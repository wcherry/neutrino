# Implementation Plan: Search Phases 1-4

## Branch: feat/search-phases-1-4

## What is changing and why
Implementing a client-side, E2EE-compatible full-text search system for the Neutrino suite.
Search tokens are HMAC-SHA256 hashed with a per-user key before being stored in IndexedDB,
so the search index never exposes plaintext terms — matching the project's E2EE principles.

## Layers affected
- **New package:** `packages/search/` — types, tokenizer, db, engine
- **Frontend (web app):** feature flag addition, search page
- **Tests:** Vitest unit tests in `packages/search/src/__tests__/`, Playwright E2E in `e2e/tests/`

## Specialist agents
- `frontend-developer`: search page + feature flag wiring
- `test-writer`: unit tests (tokenizer, engine) + E2E test

## Feature flag
- Name: `NEXT_PUBLIC_FEATURE_SEARCH`
- Key in `featureFlags.ts`: `search`
- Default: `false`

## Package: @neutrino/search
- `src/types.ts` — SearchableDocType, SearchableDocument, SearchResult
- `src/tokenizer.ts` — normalizeText, hashToken, tokenize, tokenizeWithPositions
- `src/db.ts` — openSearchDb, putTokenEntries, deleteDocumentTokens, lookupPostings
- `src/engine.ts` — IndexEngine class wrapping all of the above
- `src/index.ts` — barrel export

## Query flow
1. normalizeText(query) → string[]
2. hashToken(term, searchKey) for each → string[]
3. lookupPostings(hashes, db) → per-hash postings
4. Intersect: docIds present in ALL hashes
5. Score: title field hits × 3 + content hits
6. Sort descending, return top 20 as SearchResult[]

## Title weighting
- tokenizeWithPositions(doc.title, …) → field: 'title', score multiplier 3
- tokenizeWithPositions(doc.content, …) → field: 'content', score multiplier 1

## Known risks / edge cases
- Web Crypto is unavailable in non-secure contexts (localhost is fine; needs HTTPS in prod)
- IndexedDB compound key `['tokenHash', 'documentId']` requires all fields present
- `crypto.subtle` returns ArrayBuffer — must convert to hex string for consistent key comparison

## Acceptance criteria
- `pnpm type-check` passes
- `pnpm test` passes (unit tests green)
- Search page renders when `NEXT_PUBLIC_FEATURE_SEARCH=true`
- Playwright search spec: found/not-found/AND logic all pass

## Feature flag details
```
Flag name: NEXT_PUBLIC_FEATURE_SEARCH
featureFlags key: search
Default: false (off in all environments)
Enable in dev: add NEXT_PUBLIC_FEATURE_SEARCH=true to apps/web/.env.local
```
