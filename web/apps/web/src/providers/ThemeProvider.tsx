'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A user-defined custom theme choice, stored/applied as the literal string
 * `custom-<id>` (see agent_docs/plans/feature-custom-themes.md). Modeled as a
 * template-literal type unioned with the closed preset list below, rather
 * than widening to bare `string` — keeps autocomplete for built-ins while
 * still accepting arbitrary custom IDs.
 */
export type CustomThemeId = `custom-${string}`;

export type ThemeChoice = 'light' | 'dark' | 'system' | 'glass' | 'midnight' | 'beach' | 'forest' | 'sunbeams' | 'light-glass' | CustomThemeId;
export type ResolvedTheme = 'light' | 'dark' | 'glass' | 'midnight' | 'beach' | 'forest' | 'sunbeams' | 'light-glass' | CustomThemeId;

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  resolvedTheme: ResolvedTheme;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'neutrino.theme';

const FIXED_CHOICES: ThemeChoice[] = ['light', 'dark', 'system', 'glass', 'midnight', 'beach', 'forest', 'sunbeams', 'light-glass'];

/**
 * Valid if it's one of the fixed presets OR matches `/^custom-/`. We don't
 * validate that the custom ID actually exists client-side — a stale/deleted
 * custom theme ID just resolves to a `data-theme` attribute with no matching
 * `<style>` rule, which safely falls through to `:root` defaults with no
 * visual break (see the plan's "ThemeProvider.tsx changes" section).
 */
function isValidChoice(value: string): value is ThemeChoice {
  return (FIXED_CHOICES as string[]).includes(value) || /^custom-/.test(value);
}

function readStoredTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValidChoice(stored)) return stored;
  } catch {
    // localStorage unavailable (private browsing restrictions, etc.)
  }
  return 'system';
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice;
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'light',
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Initialise from localStorage on mount (client-only)
  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    const resolved = resolveTheme(stored);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // Re-apply whenever theme state changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme]);

  // Listen to OS preference changes when choice is 'system'
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        const resolved = resolveTheme('system');
        setResolvedTheme(resolved);
        applyTheme(resolved);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore write failures
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
