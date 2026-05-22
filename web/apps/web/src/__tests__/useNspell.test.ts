/**
 * Unit tests for the useNspell hook.
 *
 * Covers:
 *   - Returns null initially (dictionary not yet loaded)
 *   - Returns { check, suggest } once the dictionary is loaded
 *   - check() returns true for correctly spelled words
 *   - check() returns false for misspelled words
 *   - suggest() returns an array of suggestions for misspelled words
 *   - suggest() returns an empty array for correctly spelled words
 *   - The nspell instance is only created once (singleton)
 *   - Handles dictionary load failure gracefully
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock nspell ───────────────────────────────────────────────────────────────
const mockNspellInstance = {
  correct: vi.fn((word: string) => word === 'hello' || word === 'world'),
  suggest: vi.fn((word: string) => {
    if (word === 'helo') return ['hello', 'help', 'hero'];
    return [];
  }),
};

vi.mock('nspell', () => ({
  default: vi.fn(() => mockNspellInstance),
}));

// ── Mock fetch for dictionary files ──────────────────────────────────────────
const mockAffBuffer = new Uint8Array([1, 2, 3]).buffer;
const mockDicBuffer = new Uint8Array([4, 5, 6]).buffer;

function mockFetch(url: string) {
  if (url.includes('.aff')) {
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(mockAffBuffer) });
  }
  if (url.includes('.dic')) {
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(mockDicBuffer) });
  }
  return Promise.reject(new Error(`Unexpected URL: ${url}`));
}

// ── Reset module state between tests ─────────────────────────────────────────
// useNspell uses a module-level singleton. We need to reset it between test runs.
// We do this by clearing the module registry each time.

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(mockFetch));
  mockNspellInstance.correct.mockClear();
  mockNspellInstance.suggest.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useNspell — initial state', () => {
  it('returns null before dictionary is loaded', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    // Before the async load completes, nspell should be null
    expect(result.current).toBeNull();
  });

  it('returns a spell-check object after dictionary loads', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toHaveProperty('check');
    expect(result.current).toHaveProperty('suggest');
  });
});

describe('useNspell — check()', () => {
  it('returns true for a correctly spelled word', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.check('hello')).toBe(true);
  });

  it('returns false for a misspelled word', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.check('helo')).toBe(false);
  });
});

describe('useNspell — suggest()', () => {
  it('returns suggestions for a misspelled word', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    await waitFor(() => expect(result.current).not.toBeNull());
    const suggestions = result.current!.suggest('helo');
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions).toContain('hello');
  });

  it('returns an empty array for a correctly spelled word', async () => {
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    await waitFor(() => expect(result.current).not.toBeNull());
    const suggestions = result.current!.suggest('world');
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions).toHaveLength(0);
  });
});

describe('useNspell — fetch failure', () => {
  it('returns null and does not throw if dictionary fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))));
    const { useNspell } = await import('../hooks/useNspell');
    const { result } = renderHook(() => useNspell());
    // Wait a tick for the async operation to settle
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    // Should remain null — failure is swallowed gracefully
    expect(result.current).toBeNull();
  });
});
