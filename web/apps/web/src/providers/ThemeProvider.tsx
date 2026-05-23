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

export type ThemeChoice = 'light' | 'dark' | 'system' | 'glass' | 'midnight' | 'beach' | 'forest' | 'sunbeams' | 'light-glass';
export type ResolvedTheme = 'light' | 'dark' | 'glass' | 'midnight' | 'beach' | 'forest' | 'sunbeams' | 'light-glass';

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  resolvedTheme: ResolvedTheme;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'neutrino.theme';

const VALID_CHOICES: ThemeChoice[] = ['light', 'dark', 'system', 'glass', 'midnight', 'beach', 'forest', 'sunbeams', 'light-glass'];

function readStoredTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (stored && VALID_CHOICES.includes(stored)) return stored;
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
