/**
 * Unit tests for the useAvailableFonts hook (feature/custom-fonts).
 *
 * useAvailableFonts merges the built-in FONT_FAMILIES / FONT_FAMILY_NAMES
 * constants (constants/editor.ts) with custom fonts sourced from
 * CustomFontsProvider's useCustomFonts() hook, producing:
 *   - fontFamilies        — built-ins + custom, CSS-stack form (Docs/Sheets)
 *   - fontFamilyNames     — built-ins + custom, bare-name form (Slides/Diagrams)
 *   - customFontFamilies  / customFontFamilyNames — custom-only subsets
 *     (Drawing, which keeps its own bespoke built-in list and just appends)
 *   - loaded              — passthrough of useCustomFonts().loaded
 *
 * Red phase (feature/custom-fonts plan): neither
 * `web/apps/web/src/hooks/useAvailableFonts.ts` nor
 * `web/apps/web/src/providers/CustomFontsProvider.tsx` exist yet, so every
 * test below fails (or fails to import) until frontend-developer adds them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { FONT_FAMILIES, FONT_FAMILY_NAMES } from '@/constants/editor';

// ---------------------------------------------------------------------------
// Mock the (not-yet-existing) CustomFontsProvider's useCustomFonts() hook.
// ---------------------------------------------------------------------------

const mockUseCustomFonts = vi.fn();

vi.mock('@/providers/CustomFontsProvider', () => ({
  useCustomFonts: () => mockUseCustomFonts(),
}));

import { useAvailableFonts } from '@/hooks/useAvailableFonts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const customFont = {
  id: 'font-1',
  displayName: 'My Custom Font',
  format: 'woff2' as const,
  fileUrl: '/api/v1/fonts/font-1/file',
  uploadedBy: 'user-1',
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAvailableFonts', () => {
  beforeEach(() => {
    mockUseCustomFonts.mockReset();
  });

  it('returns only the built-in fonts when there are no custom fonts', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.fontFamilies).toEqual(FONT_FAMILIES);
    expect(result.current.fontFamilyNames).toEqual(FONT_FAMILY_NAMES);
  });

  it('returns empty custom-only subsets when there are no custom fonts', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.customFontFamilies).toEqual([]);
    expect(result.current.customFontFamilyNames).toEqual([]);
  });

  it('appends a custom font to fontFamilies as a CSS-stack entry', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.fontFamilies).toHaveLength(FONT_FAMILIES.length + 1);
    expect(result.current.fontFamilies).toContainEqual({
      label: 'My Custom Font',
      value: "'My Custom Font', sans-serif",
    });
  });

  it('appends a custom font to fontFamilyNames as a bare name', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.fontFamilyNames).toHaveLength(FONT_FAMILY_NAMES.length + 1);
    expect(result.current.fontFamilyNames).toContainEqual({
      label: 'My Custom Font',
      value: 'My Custom Font',
    });
  });

  it('customFontFamilies contains only the custom-font CSS-stack entries', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.customFontFamilies).toEqual([
      { label: 'My Custom Font', value: "'My Custom Font', sans-serif" },
    ]);
  });

  it('customFontFamilyNames contains only the custom-font bare names', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.customFontFamilyNames).toEqual([
      { label: 'My Custom Font', value: 'My Custom Font' },
    ]);
  });

  it('merges multiple custom fonts, preserving built-ins first', () => {
    const secondFont = { ...customFont, id: 'font-2', displayName: 'Second Font' };
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont, secondFont], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.fontFamilies.slice(0, FONT_FAMILIES.length)).toEqual(FONT_FAMILIES);
    expect(result.current.fontFamilies.slice(FONT_FAMILIES.length)).toEqual([
      { label: 'My Custom Font', value: "'My Custom Font', sans-serif" },
      { label: 'Second Font', value: "'Second Font', sans-serif" },
    ]);
  });

  it('does not mutate the built-in FONT_FAMILIES constant', () => {
    const originalLength = FONT_FAMILIES.length;
    mockUseCustomFonts.mockReturnValue({ fonts: [customFont], loaded: true });
    renderHook(() => useAvailableFonts());

    expect(FONT_FAMILIES.length).toBe(originalLength);
  });

  it('passes through loaded=false while custom fonts are still loading', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [], loaded: false });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.loaded).toBe(false);
  });

  it('passes through loaded=true once custom fonts have resolved', () => {
    mockUseCustomFonts.mockReturnValue({ fonts: [], loaded: true });
    const { result } = renderHook(() => useAvailableFonts());

    expect(result.current.loaded).toBe(true);
  });
});
