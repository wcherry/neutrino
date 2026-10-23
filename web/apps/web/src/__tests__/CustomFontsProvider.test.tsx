/**
 * Unit tests for CustomFontsProvider.
 *
 * Fetches on mount and exposes the result via context with a `loaded` flag,
 * plus the additional behavior described in
 * agent_docs/plans/feature-custom-fonts.md:
 *   - Guarded on `localStorage.getItem('access_token')` being present, so it
 *     never fires (and never triggers a 401 -> redirect loop) on
 *     /sign-in /register before a token exists.
 *   - Calls fontsApi.list() and registers each font as a placeholder face;
 *     a font's file is downloaded (fontsApi.getFileBlob) only when the
 *     browser first tries to use it, then swapped in.
 *   - Exposes useCustomFonts() -> { fonts, loaded }.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-admin's fontsApi (not yet added to that package either).
// ---------------------------------------------------------------------------

const mockList = vi.fn();
const mockGetFileBlob = vi.fn();

vi.mock('@neutrino/api-admin', () => ({
  fontsApi: {
    list: (...args: unknown[]) => mockList(...args),
    getFileBlob: (...args: unknown[]) => mockGetFileBlob(...args),
  },
}));

import { CUSTOM_FONT_LOADED, CustomFontsProvider, useCustomFonts } from '@/providers/CustomFontsProvider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleFont = {
  id: 'font-1',
  displayName: 'My Custom Font',
  format: 'woff2' as const,
  fileUrl: '/api/v1/fonts/font-1/file',
  uploadedBy: 'user-1',
  createdAt: '2026-01-01T00:00:00Z',
};

function TestConsumer() {
  const { fonts, loaded } = useCustomFonts();
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="count">{fonts.length}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <CustomFontsProvider>
      <TestConsumer />
    </CustomFontsProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomFontsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch fonts when there is no access_token in localStorage', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(mockList).not.toHaveBeenCalled();
  });

  it('leaves fonts empty when there is no access_token', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('fetches fonts on mount when an access_token is present', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
  });

  it('exposes fetched fonts via useCustomFonts()', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('sets loaded=true after the fetch settles', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });

  it('sets loaded=true even when fontsApi.list() fails', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockRejectedValue(new Error('network error'));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  describe('loading font files on demand', () => {
    // jsdom has no CSS Font Loading API, so a small stand-in records what is registered and lets a
    // test play the browser's part: fire `loadingerror` when text first uses a placeholder.
    class FakeFontFace {
      constructor(public family: string, public source: string | ArrayBuffer) {}
      load() { return Promise.resolve(this); }
    }
    let faces: Set<FakeFontFace>;
    let fontSet: EventTarget & { add: (f: FakeFontFace) => void; delete: (f: FakeFontFace) => void };

    beforeEach(() => {
      faces = new Set();
      fontSet = Object.assign(new EventTarget(), {
        add: (f: FakeFontFace) => { faces.add(f); },
        delete: (f: FakeFontFace) => { faces.delete(f); },
      });
      vi.stubGlobal('FontFace', FakeFontFace);
      Object.defineProperty(document, 'fonts', { value: fontSet, configurable: true });
      localStorage.setItem('access_token', 'test-token');
      mockList.mockResolvedValue([sampleFont, { ...sampleFont, id: 'font-2', displayName: 'Other Font', fileUrl: '/api/v1/fonts/font-2/file' }]);
      mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete (document as { fonts?: unknown }).fonts;
    });

    function useFont(family: string) {
      const face = [...faces].find((f) => f.family === family && typeof f.source === 'string')!;
      const event = Object.assign(new Event('loadingerror'), { fontfaces: [face] });
      fontSet.dispatchEvent(event);
    }

    it('registers every font without downloading any file', async () => {
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
      expect([...faces].map((f) => f.family)).toEqual(['My Custom Font', 'Other Font']);
      expect([...faces].every((f) => typeof f.source === 'string' && f.source.startsWith('local('))).toBe(true);
      expect(mockGetFileBlob).not.toHaveBeenCalled();
    });

    it('downloads a font the first time it is used, swaps it in and announces it', async () => {
      const announced: string[] = [];
      const listener = (e: Event) => announced.push((e as CustomEvent<{ family: string }>).detail.family);
      window.addEventListener(CUSTOM_FONT_LOADED, listener);
      renderProvider();
      await waitFor(() => expect(faces.size).toBe(2));

      useFont('My Custom Font');

      await waitFor(() => expect([...faces].some((f) => f.source instanceof ArrayBuffer)).toBe(true));
      expect(mockGetFileBlob).toHaveBeenCalledTimes(1);
      expect(mockGetFileBlob).toHaveBeenCalledWith(sampleFont.fileUrl);
      const mine = [...faces].filter((f) => f.family === 'My Custom Font');
      expect(mine).toHaveLength(1);
      expect(mine[0].source).toBeInstanceOf(ArrayBuffer);
      // So a canvas that drew the fallback can redraw.
      expect(announced).toEqual(['My Custom Font']);
      window.removeEventListener(CUSTOM_FONT_LOADED, listener);
    });

    it('downloads each font at most once', async () => {
      renderProvider();
      await waitFor(() => expect(faces.size).toBe(2));
      const placeholder = [...faces].find((f) => f.family === 'My Custom Font')!;

      fontSet.dispatchEvent(Object.assign(new Event('loadingerror'), { fontfaces: [placeholder] }));
      fontSet.dispatchEvent(Object.assign(new Event('loadingerror'), { fontfaces: [placeholder] }));

      await waitFor(() => expect(mockGetFileBlob).toHaveBeenCalledTimes(1));
    });

    it('removes its fonts when unmounted', async () => {
      const { unmount } = renderProvider();
      await waitFor(() => expect(faces.size).toBe(2));
      unmount();
      expect(faces.size).toBe(0);
    });
  });

  it('useCustomFonts returns safe defaults when used outside the provider', () => {
    function Outside() {
      const { fonts, loaded } = useCustomFonts();
      return <span data-testid="outside">{`${fonts.length}-${loaded}`}</span>;
    }
    render(<Outside />);
    expect(screen.getByTestId('outside').textContent).toBe('0-false');
  });
});
