/**
 * Unit tests for CustomFontsProvider (feature/custom-fonts, red phase).
 *
 * Mirrors FeatureFlagsProvider.tsx's shape (fetch on mount, expose via
 * context with a `loaded` flag), plus the additional behavior described in
 * agent_docs/plans/feature-custom-fonts.md:
 *   - Guarded on `localStorage.getItem('access_token')` being present, so it
 *     never fires (and never triggers a 401 -> redirect loop) on
 *     /sign-in /register before a token exists.
 *   - Calls fontsApi.list(), then fontsApi.getFileBlob(font.fileUrl) for
 *     each font, builds one @font-face rule per font pointing at
 *     URL.createObjectURL(blob), and injects them into a single
 *     <style id="neutrino-custom-fonts"> tag in document.head.
 *   - Exposes useCustomFonts() -> { fonts, loaded }.
 *
 * The module (web/apps/web/src/providers/CustomFontsProvider.tsx) does not
 * exist yet — every test below fails (or fails to import) until
 * frontend-developer adds it.
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

import { CustomFontsProvider, useCustomFonts } from '@/providers/CustomFontsProvider';

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
    document.getElementById('neutrino-custom-fonts')?.remove();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  });

  afterEach(() => {
    document.getElementById('neutrino-custom-fonts')?.remove();
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

  it('calls fontsApi.getFileBlob with each font\'s fileUrl', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => expect(mockGetFileBlob).toHaveBeenCalledWith(sampleFont.fileUrl));
  });

  it('injects a <style id="neutrino-custom-fonts"> tag into document.head', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => {
      const style = document.getElementById('neutrino-custom-fonts');
      expect(style).not.toBeNull();
      expect(style?.tagName).toBe('STYLE');
    });
  });

  it('injects an @font-face rule referencing the font display name and a blob object URL', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => {
      const style = document.getElementById('neutrino-custom-fonts');
      expect(style?.textContent).toContain('@font-face');
    });
    const style = document.getElementById('neutrino-custom-fonts')!;
    expect(style.textContent).toContain('My Custom Font');
    expect(style.textContent).toContain('blob:mock-url');
  });

  it('does not duplicate the injected <style> tag across the app', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockList.mockResolvedValue([sampleFont]);
    mockGetFileBlob.mockResolvedValue(new Blob(['fake font bytes']));

    renderProvider();

    await waitFor(() => expect(document.getElementById('neutrino-custom-fonts')).not.toBeNull());
    const styleTags = document.querySelectorAll('#neutrino-custom-fonts');
    expect(styleTags.length).toBe(1);
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
