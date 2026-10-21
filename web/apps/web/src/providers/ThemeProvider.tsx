'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { usePreference } from '@neutrino/preferences';

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

/**
 * The choice is the `appearance.theme` preference (`@neutrino/preferences`), which syncs it
 * across devices and validates it — a stale or unknown value resolves to `system` there, so
 * nothing here re-checks it. A deleted custom theme's id still resolves to a `data-theme` with
 * no matching rule, which falls through to `:root` with no visual break.
 */
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
  const [theme, setThemePreference] = usePreference('appearance.theme') as [ThemeChoice, (t: ThemeChoice) => void];
  const [look] = usePreference('appearance.look');
  const [density] = usePreference('appearance.density');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // The anti-FOUC script applied all three before first paint; these keep them current.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-look', look);
  }, [look]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

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

  const setTheme = useCallback((t: ThemeChoice) => setThemePreference(t), [setThemePreference]);

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
