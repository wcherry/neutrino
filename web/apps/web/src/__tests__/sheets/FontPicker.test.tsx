/**
 * Component test for the Sheets StyleToolbar's font-family picker
 * (feature/custom-fonts plan, ~StyleToolbar.tsx line 17, 127-133).
 *
 * Today StyleToolbar.tsx imports FONT_FAMILIES directly from
 * `@/constants/editor`. The plan wires it instead to
 * `const { fontFamilies } = useAvailableFonts()`, which merges the built-ins
 * with admin-uploaded custom fonts.
 *
 * Red phase: `@/hooks/useAvailableFonts` does not exist yet, and
 * StyleToolbar.tsx has not been wired to it, so this test's mock of the hook
 * is inert today — the font select only shows the built-in fonts, and the
 * assertion expecting the mocked custom font to also appear fails until
 * frontend-developer completes the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { FONT_FAMILIES } from '@/constants/editor';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the component under test.
// ---------------------------------------------------------------------------

vi.mock('@neutrino/ui', () => ({
  Toolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ToolbarGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ToolbarDivider: () => <hr />,
  ToolbarButton: ({ children, onClick, title }: { children?: React.ReactNode; onClick?: () => void; title?: string }) => (
    <button onClick={onClick} title={title}>{children}</button>
  ),
  ToolbarSelect: ({
    children,
    value,
    onChange,
    title,
    disabled,
  }: {
    children?: React.ReactNode;
    value?: string | number;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    title?: string;
    disabled?: boolean;
  }) => (
    <select title={title} value={value} onChange={onChange} disabled={disabled}>
      {children}
    </select>
  ),
  ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const CUSTOM_FONT_OPTION = { label: 'My Custom Font', value: "'My Custom Font', sans-serif" };

vi.mock('@/hooks/useAvailableFonts', () => ({
  useAvailableFonts: () => ({
    fontFamilies: [...FONT_FAMILIES, CUSTOM_FONT_OPTION],
    fontFamilyNames: [],
    customFontFamilies: [CUSTOM_FONT_OPTION],
    customFontFamilyNames: [],
    loaded: true,
  }),
}));

import { StyleToolbar } from '../../app/(apps)/sheets/editor/StyleToolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseProps() {
  return {
    cellStyle: undefined,
    onStyleChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    onMergeCells: vi.fn(),
    isMerged: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sheets StyleToolbar — font-family picker (feature/custom-fonts)', () => {
  it('renders an option for every built-in font', () => {
    render(<StyleToolbar {...baseProps()} />);

    const select = screen.getByTitle('Font family');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    for (const font of FONT_FAMILIES) {
      expect(optionLabels).toContain(font.label);
    }
  });

  it('renders an option for a custom font returned by useAvailableFonts', () => {
    render(<StyleToolbar {...baseProps()} />);

    const select = screen.getByTitle('Font family');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toContain('My Custom Font');
  });
});
