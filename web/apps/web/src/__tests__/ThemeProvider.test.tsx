import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ThemeProvider, useTheme } from '../providers/ThemeProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TestConsumer() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <TestConsumer />
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // jsdom does not implement matchMedia — provide a light-mode stub by default
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it('defaults to system theme when nothing is stored', () => {
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('system');
  });

  it('resolves system theme to light when OS prefers light', () => {
    // matchMedia stub already returns matches: false (light)
    renderProvider();
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('resolves system theme to dark when OS prefers dark', () => {
    (window.matchMedia as unknown as Mock).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    renderProvider();
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('reads stored light theme from localStorage', () => {
    localStorage.setItem('neutrino.theme', 'light');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('reads stored dark theme from localStorage', () => {
    localStorage.setItem('neutrino.theme', 'dark');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('sets data-theme attribute on documentElement', async () => {
    localStorage.setItem('neutrino.theme', 'dark');
    renderProvider();
    // Allow effects to flush
    await act(async () => {});
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists theme choice to localStorage on setTheme', async () => {
    renderProvider();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Set Dark' }));
    });
    expect(localStorage.getItem('neutrino.theme')).toBe('dark');
  });

  it('updates data-theme when setTheme is called', async () => {
    renderProvider();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Set Dark' }));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolvedTheme is always light or dark, never system', async () => {
    // matchMedia stub returns matches: false (light) by default
    renderProvider();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Set System' }));
    });

    const resolved = screen.getByTestId('resolved').textContent;
    expect(resolved === 'light' || resolved === 'dark').toBe(true);
  });

  it('updates resolved theme when OS preference changes (system mode)', async () => {
    let mqChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;

    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
        mqChangeHandler = handler;
      },
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    renderProvider();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Set System' }));
    });

    // Simulate OS switching to dark
    (window.matchMedia as unknown as Mock).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    await act(async () => {
      if (mqChangeHandler) mqChangeHandler({} as MediaQueryListEvent);
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('useTheme returns default context values when used outside ThemeProvider', () => {
    function OutsideConsumer() {
      const { theme, resolvedTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <span data-testid="resolved">{resolvedTheme}</span>
        </div>
      );
    }
    render(<OutsideConsumer />);
    // Default context values from createContext
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  // -------------------------------------------------------------------------
  // Custom themes (feature/custom-themes, red phase)
  //
  // A custom theme choice is stored as the literal string `custom-<id>`
  // (see agent_docs/plans/feature-custom-themes.md). Today's `VALID_CHOICES`
  // is a closed 9-name list, so a stored `custom-<id>` value is currently
  // rejected by `readStoredTheme` and silently falls back to `'system'` —
  // every test in this block is expected to FAIL until frontend-developer
  // relaxes the validity check to also accept `/^custom-/` (see the plan's
  // "ThemeProvider.tsx changes" section) and updates `resolveTheme`/
  // `applyTheme` to treat a custom id as already-resolved.
  // -------------------------------------------------------------------------
  describe('custom theme ids', () => {
    it('accepts a stored custom-<id> theme choice instead of resetting it to system', () => {
      localStorage.setItem('neutrino.theme', 'custom-abc123');
      renderProvider();
      expect(screen.getByTestId('theme').textContent).toBe('custom-abc123');
    });

    it('resolves a custom theme choice to itself, never further to light/dark', () => {
      localStorage.setItem('neutrino.theme', 'custom-abc123');
      renderProvider();
      expect(screen.getByTestId('resolved').textContent).toBe('custom-abc123');
    });

    it('sets data-theme to the literal custom id string via applyTheme', async () => {
      localStorage.setItem('neutrino.theme', 'custom-abc123');
      renderProvider();
      await act(async () => {});
      expect(document.documentElement.getAttribute('data-theme')).toBe('custom-abc123');
    });

    it('setTheme accepts a custom-<id> value and applies + persists it', async () => {
      function CustomConsumer() {
        const { theme, setTheme, resolvedTheme } = useTheme();
        return (
          <div>
            <span data-testid="theme">{theme}</span>
            <span data-testid="resolved">{resolvedTheme}</span>
            <button onClick={() => setTheme('custom-xyz789' as never)}>Set Custom</button>
          </div>
        );
      }
      render(
        <ThemeProvider>
          <CustomConsumer />
        </ThemeProvider>
      );
      await act(async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Set Custom' }));
      });
      expect(screen.getByTestId('theme').textContent).toBe('custom-xyz789');
      expect(localStorage.getItem('neutrino.theme')).toBe('custom-xyz789');
      expect(document.documentElement.getAttribute('data-theme')).toBe('custom-xyz789');
    });
  });
});
