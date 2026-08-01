/**
 * Guards the colour contract behind issue #72 ("Search box displays light gray
 * text on white background").
 *
 * The `--color-neutral-*` ramp is declared once on `:root` in
 * `@neutrino/tokens` and no theme block overrides it, so a component that
 * reaches for a raw neutral keeps its light-mode colour on every dark theme.
 * `SearchInput` did that for its hover background, which put a near-white pill
 * behind near-white `--color-text-primary` text.
 *
 * jsdom can't catch this — CSS Modules are stubbed in tests and no real
 * cascade runs — so the stylesheets are asserted on directly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const searchInputSource = readFileSync(
  path.resolve(__dirname, '../components/inputs/SearchInput.module.css'),
  'utf8',
);
const tokensCss = readFileSync(
  path.resolve(__dirname, '../../../tokens/src/colors.css'),
  'utf8',
);

/** Declarations only — the comments in this file name the tokens they warn about. */
const searchInputCss = searchInputSource.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `var(--…)` colour token a stylesheet depends on. */
function colorTokensUsedIn(css: string): string[] {
  return [...new Set(css.match(/--color-[a-z0-9-]+/g) ?? [])];
}

/** The selector blocks a token is declared in: `:root` plus each theme. */
function declarationCount(token: string): number {
  return tokensCss.split(`${token}:`).length - 1;
}

const THEME_COUNT = (tokensCss.match(/^\[data-theme=/gm) ?? []).length;

describe('SearchInput theming', () => {
  it('has themes to check', () => {
    // Guards the assertions below against silently passing if the token file
    // is restructured.
    expect(THEME_COUNT).toBeGreaterThan(0);
  });

  it('never reaches for the raw neutral ramp, which does not follow the theme', () => {
    expect(searchInputCss).not.toMatch(/--color-neutral-/);
  });

  it('only uses colour tokens that every theme redefines', () => {
    const perTheme = declarationCount('--color-neutral-100');
    // Sanity: the ramp really is light-mode-only, which is what makes it unsafe.
    expect(perTheme).toBe(1);

    const underDefined = colorTokensUsedIn(searchInputCss).filter(
      (token) => declarationCount(token) < THEME_COUNT + 1,
    );
    expect(underDefined).toEqual([]);
  });

  it('keeps the focus background from being overridden by hover', () => {
    // `.subtle .input:hover:not(:disabled)` outranks a bare `:focus`, so a
    // focused input under the pointer would take the hover background. Both
    // rules carry `:not(:disabled)` so source order decides instead.
    const hover = searchInputCss.indexOf('.subtle .input:hover:not(:disabled)');
    const focus = searchInputCss.indexOf('.subtle .input:focus:not(:disabled)');
    expect(hover).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(hover);
  });
});
