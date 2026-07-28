'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { themesApi } from '@neutrino/api-themes';
import type { CustomTheme } from '@neutrino/api-themes';

const STYLE_TAG_ID = 'neutrino-custom-themes';

type CustomThemesContextValue = {
  themes: CustomTheme[];
  loaded: boolean;
  /** Re-fetches the theme list and re-injects the `<style>` tag. Used after
   *  any mutation (duplicate, delete, make-public, edit-save) so the grid
   *  reflects the change immediately without a full page reload. Same
   *  `access_token` guard as the mount fetch. */
  refetch: () => Promise<void>;
};

const CustomThemesContext = createContext<CustomThemesContextValue>({
  themes: [],
  loaded: false,
  refetch: async () => {},
});

// ---------------------------------------------------------------------------
// <style> generation
//
// Mirrors CustomFontsProvider's injected-<style>-tag pattern, but builds one
// `[data-theme="custom-<id>"] { ... }` rule per visible theme directly from
// the theme's own `tokens` map. Values are already validated server-side
// (strict hex/rgb allowlist — see src/themes/service.rs), but we sanitize
// defensively here too since these strings are interpolated into a <style>
// tag on every page load (defense in depth, not the primary guard).
// ---------------------------------------------------------------------------

const TOKEN_KEY_PATTERN = /^--[a-zA-Z0-9-]+$/;

/** Strip anything that could break out of a CSS declaration or rule body. */
function sanitizeCssValue(value: string): string {
  return value.replace(/[{}<>;"'\\]/g, '');
}

/** Custom theme ids are opaque backend-generated strings; keep only safe chars. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function buildThemeRule(theme: CustomTheme): string {
  const declarations: string[] = [];
  declarations.push(`color-scheme: ${theme.colorScheme === 'dark' ? 'dark' : 'light'};`);

  for (const [key, value] of Object.entries(theme.tokens)) {
    if (!TOKEN_KEY_PATTERN.test(key)) continue;
    declarations.push(`${key}: ${sanitizeCssValue(value)};`);
  }

  // Aliases mirrored the same way for every theme regardless of light/dark
  // base — a deliberate simplification since custom themes have no
  // neutral-50/100 scale to draw a distinct "past"/"secondary" surface from
  // (see the plan's "CustomThemesProvider.tsx" section).
  declarations.push('--color-text: var(--color-text-primary);');
  declarations.push('--color-text-tertiary: var(--color-text-muted);');
  declarations.push('--color-surface-secondary: var(--color-surface-raised);');
  declarations.push('--color-surface-past: var(--color-surface-raised);');
  declarations.push('--color-surface-hover: var(--color-surface-raised);');
  declarations.push('--color-primary: var(--color-accent);');
  declarations.push('--color-primary-light: var(--color-accent-subtle);');

  const selector = `[data-theme="custom-${sanitizeId(theme.id)}"]`;
  return `${selector} {\n  ${declarations.join('\n  ')}\n}`;
}

function injectCustomThemeStyles(themes: CustomTheme[]): void {
  let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    document.head.appendChild(style);
  }
  style.textContent = themes.map(buildThemeRule).join('\n\n');
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CustomThemesProvider({ children }: { children: React.ReactNode }) {
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Shared by the mount effect and the exposed `refetch()` — same
  // `access_token` guard both times, so calling `refetch()` when the user
  // was never signed in (or has since signed out) is a safe no-op.
  const fetchAndInject = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) return;

    try {
      const res = await themesApi.listThemes();
      setThemes(res.themes);
      injectCustomThemeStyles(res.themes);
    } catch {
      // Leave themes as-is; built-in presets remain fully usable.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) {
      setLoaded(true);
      return;
    }

    themesApi
      .listThemes()
      .then((res) => {
        if (cancelled) return;
        setThemes(res.themes);
        injectCustomThemeStyles(res.themes);
      })
      .catch(() => {
        // Leave themes empty; built-in presets remain fully usable.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CustomThemesContext.Provider value={{ themes, loaded, refetch: fetchAndInject }}>
      {children}
    </CustomThemesContext.Provider>
  );
}

export function useCustomThemes(): CustomThemesContextValue {
  return useContext(CustomThemesContext);
}
