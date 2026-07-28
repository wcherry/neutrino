import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Custom theme types
// ---------------------------------------------------------------------------

export type ThemeColorScheme = 'light' | 'dark';

export interface CustomTheme {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  isOwner: boolean;
  colorScheme: ThemeColorScheme;
  /** Exact canonical CSS custom-property names (with the `--` prefix) → color values. */
  tokens: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateThemeRequest {
  name: string;
  colorScheme: ThemeColorScheme;
  tokens: Record<string, string>;
  isPublic: boolean;
}

export interface UpdateThemeRequest {
  name?: string;
  colorScheme?: ThemeColorScheme;
  tokens?: Record<string, string>;
  isPublic?: boolean;
}

export interface ListThemesResponse {
  themes: CustomTheme[];
}

/**
 * Single source of truth for the ~24 canonical color token keys a custom
 * theme may set. Mirrored exactly (including the `--` prefix and field order)
 * from `src/themes/dto.rs`'s `CANONICAL_THEME_TOKENS` const — diffed against
 * `web/packages/tokens/src/colors.css` lines 1-57. Do not add/remove/rename
 * entries here without updating the Rust allowlist in lockstep (see
 * agent_docs/plans/feature-custom-themes.md's "Token key drift" risk note).
 */
export const CANONICAL_THEME_TOKENS = [
  '--color-bg',
  '--color-bg-subtle',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-overlay',
  '--color-border',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-text-inverse',
  '--color-text-on-accent',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-subtle',
  '--color-accent-text',
  '--color-success',
  '--color-success-subtle',
  '--color-warning',
  '--color-warning-subtle',
  '--color-error',
  '--color-error-subtle',
  '--color-info',
  '--color-info-subtle',
] as const;

export type CanonicalThemeToken = (typeof CANONICAL_THEME_TOKENS)[number];

// ---------------------------------------------------------------------------
// Themes API
// ---------------------------------------------------------------------------

export const themesApi = {
  async listThemes(): Promise<ListThemesResponse> {
    return request<ListThemesResponse>('/api/v1/themes');
  },

  async createTheme(body: CreateThemeRequest): Promise<CustomTheme> {
    return request<CustomTheme>('/api/v1/themes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateTheme(themeId: string, body: UpdateThemeRequest): Promise<CustomTheme> {
    return request<CustomTheme>(`/api/v1/themes/${themeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteTheme(themeId: string): Promise<void> {
    await request<void>(`/api/v1/themes/${themeId}`, { method: 'DELETE' });
  },
};
