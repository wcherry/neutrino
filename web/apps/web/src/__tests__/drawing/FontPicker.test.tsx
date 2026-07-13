/**
 * Component test for the Drawing StylePanel's font-family picker
 * (feature/custom-fonts plan, ~StylePanel.tsx line 82, 243-247).
 *
 * Unlike the other 4 editors, Drawing keeps its own bespoke built-in
 * FONT_FAMILIES array (it includes generic `sans-serif`/`serif`/`monospace`
 * entries the others don't) and is meant to *append*
 * `useAvailableFonts().customFontFamilies` to it, rather than fully
 * replacing the list the way Docs/Slides/Sheets do.
 *
 * Red phase: `@/hooks/useAvailableFonts` does not exist yet, and
 * StylePanel.tsx has not been wired to it, so this test's mock of the hook
 * is inert today — the font select only shows StylePanel's own bespoke
 * built-ins, and the assertion expecting the mocked custom font to also
 * appear fails until frontend-developer completes the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Shape } from '../../app/(apps)/drawing/editor/types';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the component under test.
// ---------------------------------------------------------------------------

vi.mock('@neutrino/ui', () => ({
  FillPicker: () => null,
  ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../app/(apps)/drawing/editor/StylePanel.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

const CUSTOM_FONT_OPTION = { label: 'My Custom Font', value: 'My Custom Font' };

vi.mock('@/hooks/useAvailableFonts', () => ({
  useAvailableFonts: () => ({
    fontFamilies: [],
    fontFamilyNames: [],
    customFontFamilies: [CUSTOM_FONT_OPTION],
    customFontFamilyNames: [],
    loaded: true,
  }),
}));

import { StylePanel } from '../../app/(apps)/drawing/editor/StylePanel';

// Drawing's own bespoke built-in list (mirrors the private FONT_FAMILIES
// const at the top of StylePanel.tsx — kept in sync here deliberately since
// it is not exported).
const DRAWING_BUILTIN_FONTS = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 'shape-1',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 24,
    points: [],
    text: 'Hello',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 1,
    rotation: 0,
    opacity: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drawing StylePanel — font-family picker (feature/custom-fonts)', () => {
  it('renders an option for every built-in font when a text shape is selected', () => {
    const shape = makeTextShape();
    render(
      <StylePanel
        shapes={[shape]}
        selectedIds={[shape.id]}
        onStyleChange={vi.fn()}
        onToggleLock={vi.fn()}
      />
    );

    const select = screen.getByDisplayValue('Sans-serif').closest('select') as HTMLSelectElement;
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    for (const font of DRAWING_BUILTIN_FONTS) {
      expect(optionLabels).toContain(font.label);
    }
  });

  it('appends a custom font from useAvailableFonts to the built-in list', () => {
    const shape = makeTextShape();
    render(
      <StylePanel
        shapes={[shape]}
        selectedIds={[shape.id]}
        onStyleChange={vi.fn()}
        onToggleLock={vi.fn()}
      />
    );

    const select = screen.getByDisplayValue('Sans-serif').closest('select') as HTMLSelectElement;
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toContain('My Custom Font');
  });

  it('does not render a font picker for non-text shapes (unrelated to fonts, guards the test harness)', () => {
    const shape = makeTextShape({ type: 'rectangle', fontFamily: undefined });
    render(
      <StylePanel
        shapes={[shape]}
        selectedIds={[shape.id]}
        onStyleChange={vi.fn()}
        onToggleLock={vi.fn()}
      />
    );

    expect(screen.queryByText('Font')).not.toBeInTheDocument();
  });
});
