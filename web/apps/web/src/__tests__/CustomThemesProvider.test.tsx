/**
 * Unit tests for CustomThemesProvider (feature/custom-themes, red phase).
 *
 * Mirrors CustomFontsProvider.tsx's shape exactly (fetch-on-mount guarded by
 * an `access_token` in localStorage, expose via context with a `loaded`
 * flag), but instead of injecting @font-face rules from blob URLs, it
 * injects one `[data-theme="custom-<id>"] { ... }` CSS rule per visible
 * theme built directly from the theme's own `tokens` map — see
 * agent_docs/plans/feature-custom-themes.md's "CustomThemesProvider.tsx"
 * section.
 *
 * Neither `web/apps/web/src/providers/CustomThemesProvider.tsx` nor the
 * `@neutrino/api-themes` package exists yet — every test below fails (or
 * fails to import) until frontend-developer adds them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-themes's themesApi (package does not exist yet either).
// ---------------------------------------------------------------------------

const mockListThemes = vi.fn();

vi.mock('@neutrino/api-themes', () => ({
  themesApi: {
    listThemes: (...args: unknown[]) => mockListThemes(...args),
  },
}));

import { CustomThemesProvider, useCustomThemes } from '@/providers/CustomThemesProvider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleTheme = {
  id: 'theme-1',
  userId: 'user-1',
  name: 'My Custom Theme',
  isPublic: false,
  isOwner: true,
  colorScheme: 'dark' as const,
  tokens: {
    '--color-bg': '#111111',
    '--color-accent': '#4f46e5',
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function TestConsumer() {
  const { themes, loaded } = useCustomThemes();
  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="count">{themes.length}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <CustomThemesProvider>
      <TestConsumer />
    </CustomThemesProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomThemesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.getElementById('neutrino-custom-themes')?.remove();
  });

  afterEach(() => {
    document.getElementById('neutrino-custom-themes')?.remove();
    vi.restoreAllMocks();
  });

  it('does not fetch themes when there is no access_token in localStorage', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(mockListThemes).not.toHaveBeenCalled();
  });

  it('leaves themes empty when there is no access_token', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('fetches themes on mount when an access_token is present', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    renderProvider();

    await waitFor(() => expect(mockListThemes).toHaveBeenCalled());
  });

  it('exposes fetched themes via useCustomThemes()', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('sets loaded=true after the fetch settles', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });

  it('sets loaded=true even when themesApi.listThemes() fails, leaving themes empty', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockRejectedValue(new Error('network error'));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('injects a <style id="neutrino-custom-themes"> tag into document.head', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    renderProvider();

    await waitFor(() => {
      const style = document.getElementById('neutrino-custom-themes');
      expect(style).not.toBeNull();
      expect(style?.tagName).toBe('STYLE');
    });
  });

  it('injects one [data-theme="custom-<id>"] rule per theme containing its token values', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    renderProvider();

    await waitFor(() => {
      const style = document.getElementById('neutrino-custom-themes');
      expect(style?.textContent).toContain('[data-theme="custom-theme-1"]');
    });
    const style = document.getElementById('neutrino-custom-themes')!;
    expect(style.textContent).toContain('#111111');
    expect(style.textContent).toContain('#4f46e5');
  });

  it('injects a separate rule per theme when multiple themes are returned', async () => {
    localStorage.setItem('access_token', 'test-token');
    const secondTheme = {
      ...sampleTheme,
      id: 'theme-2',
      name: 'Another Theme',
      colorScheme: 'light' as const,
      tokens: { '--color-bg': '#fefefe' },
    };
    mockListThemes.mockResolvedValue({ themes: [sampleTheme, secondTheme] });

    renderProvider();

    await waitFor(() => {
      const style = document.getElementById('neutrino-custom-themes');
      expect(style?.textContent).toContain('[data-theme="custom-theme-1"]');
      expect(style?.textContent).toContain('[data-theme="custom-theme-2"]');
    });
    const style = document.getElementById('neutrino-custom-themes')!;
    expect(style.textContent).toContain('#fefefe');
  });

  it('does not duplicate the injected <style> tag across multiple mounts', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    const { unmount } = renderProvider();
    await waitFor(() => expect(document.getElementById('neutrino-custom-themes')).not.toBeNull());
    unmount();

    renderProvider();
    await waitFor(() => expect(mockListThemes).toHaveBeenCalledTimes(2));

    const styleTags = document.querySelectorAll('#neutrino-custom-themes');
    expect(styleTags.length).toBe(1);
  });

  it('does not duplicate the injected <style> tag on re-render with the same data', async () => {
    localStorage.setItem('access_token', 'test-token');
    mockListThemes.mockResolvedValue({ themes: [sampleTheme] });

    const { rerender } = renderProvider();
    await waitFor(() => expect(document.getElementById('neutrino-custom-themes')).not.toBeNull());

    rerender(
      <CustomThemesProvider>
        <TestConsumer />
      </CustomThemesProvider>
    );

    const styleTags = document.querySelectorAll('#neutrino-custom-themes');
    expect(styleTags.length).toBe(1);
  });

  it('useCustomThemes returns safe defaults when used outside the provider', () => {
    function Outside() {
      const { themes, loaded } = useCustomThemes();
      return <span data-testid="outside">{`${themes.length}-${loaded}`}</span>;
    }
    render(<Outside />);
    expect(screen.getByTestId('outside').textContent).toBe('0-false');
  });
});
