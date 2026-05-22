/**
 * Unit tests for the useDictionaryLookup hook.
 *
 * Covers:
 *   - Returns { status: 'idle' } initially
 *   - lookup() transitions to 'loading' then 'found' on success
 *   - lookup() transitions to 'not-found' when API returns 404
 *   - lookup() transitions to 'error' on network failure
 *   - Caches results so the API is not called twice for the same word
 *   - reset() returns state to idle
 *   - Definitions contain phonetic and meanings when available
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Helpers ────────────────────────────────────────────────────────────────────

const MOCK_DEFINITION_RESPONSE = [
  {
    word: 'hello',
    phonetic: '/həˈloʊ/',
    meanings: [
      {
        partOfSpeech: 'exclamation',
        definitions: [
          { definition: 'Used as a greeting or to begin a telephone conversation.' },
        ],
      },
    ],
  },
];

function mockFetchSuccess(url: string) {
  if (url.includes('/hello')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_DEFINITION_RESPONSE),
    });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ title: 'No Definitions Found' }) });
}

function mockFetchNetworkError() {
  return Promise.reject(new Error('network error'));
}

// ── Reset module-level cache between tests ────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useDictionaryLookup — initial state', () => {
  it('returns idle status initially', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());
    expect(result.current.status).toBe('idle');
    expect(result.current.word).toBeUndefined();
    expect(result.current.entry).toBeUndefined();
  });
});

describe('useDictionaryLookup — successful lookup', () => {
  it('transitions to found and returns definition data', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });

    await waitFor(() => expect(result.current.status).toBe('found'));

    expect(result.current.word).toBe('hello');
    expect(result.current.entry).toBeDefined();
    expect(result.current.entry?.word).toBe('hello');
    expect(result.current.entry?.meanings.length).toBeGreaterThan(0);
  });

  it('entry includes phonetic when available', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('found'));

    expect(result.current.entry?.phonetic).toBe('/həˈloʊ/');
  });

  it('entry meanings contain partOfSpeech and definitions', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('found'));

    const meaning = result.current.entry?.meanings[0];
    expect(meaning?.partOfSpeech).toBe('exclamation');
    expect(meaning?.definitions[0].definition).toBeTruthy();
  });
});

describe('useDictionaryLookup — word not found', () => {
  it('transitions to not-found for unknown words', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('xyzzyplugh'); });
    await waitFor(() => expect(result.current.status).toBe('not-found'));

    expect(result.current.entry).toBeUndefined();
  });
});

describe('useDictionaryLookup — network error', () => {
  it('transitions to error status on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchNetworkError));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('useDictionaryLookup — caching', () => {
  it('does not call fetch twice for the same word', async () => {
    const fetchFn = vi.fn(mockFetchSuccess);
    vi.stubGlobal('fetch', fetchFn);
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('found'));

    const callsAfterFirst = fetchFn.mock.calls.length;

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('found'));

    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('useDictionaryLookup — reset', () => {
  it('reset() returns status to idle', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchSuccess));
    const { useDictionaryLookup } = await import('../hooks/useDictionaryLookup');
    const { result } = renderHook(() => useDictionaryLookup());

    act(() => { result.current.lookup('hello'); });
    await waitFor(() => expect(result.current.status).toBe('found'));

    act(() => { result.current.reset(); });
    expect(result.current.status).toBe('idle');
    expect(result.current.word).toBeUndefined();
    expect(result.current.entry).toBeUndefined();
  });
});
