/**
 * Component test for the Docs Toolbar's font-family picker
 * (feature/custom-fonts plan, ~Toolbar.tsx line 355-368).
 *
 * Today Toolbar.tsx imports FONT_FAMILIES directly from
 * `@/constants/editor` and renders only the built-in fonts. The plan wires
 * it instead to `const { fontFamilies } = useAvailableFonts()`, which merges
 * the built-ins with admin-uploaded custom fonts.
 *
 * Red phase: `@/hooks/useAvailableFonts` does not exist yet, and Toolbar.tsx
 * has not been wired to it, so this test's mock of the hook is inert today —
 * the font select only shows the built-in fonts, and the assertion below
 * (expecting the mocked custom font to also appear) fails until
 * frontend-developer completes the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
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
  }: {
    children?: React.ReactNode;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    title?: string;
  }) => (
    <select title={title} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({}),
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

import { Toolbar } from '../../app/(apps)/docs/editor/Toolbar';

// ---------------------------------------------------------------------------
// Mock tiptap editor — a chainable proxy so any `.chain().x().y().run()`
// call resolves without needing to enumerate every tiptap command used
// across the (large) Toolbar component.
// ---------------------------------------------------------------------------

function makeChainProxy(): unknown {
  const proxy: unknown = new Proxy(() => undefined, {
    get(_target, prop) {
      if (prop === 'run') return () => true;
      return () => proxy;
    },
  });
  return proxy;
}

function makeCanProxy(): unknown {
  return new Proxy(
    {},
    {
      get: () => () => true,
    }
  );
}

function makeMockEditor(): Editor {
  return {
    isActive: () => false,
    can: () => makeCanProxy(),
    chain: () => makeChainProxy(),
    getAttributes: (name: string) => (name === 'textStyle' ? { fontFamily: '' } : {}),
  } as unknown as Editor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Docs Toolbar — font-family picker (feature/custom-fonts)', () => {
  it('renders an option for every built-in font', () => {
    render(<Toolbar editor={makeMockEditor()} onInsertImage={vi.fn()} />);

    const select = screen.getByTitle('Font family');
    for (const font of FONT_FAMILIES) {
      expect(
        Array.from(select.querySelectorAll('option')).some((o) => o.textContent === font.label)
      ).toBe(true);
    }
  });

  it('renders an option for a custom font returned by useAvailableFonts', () => {
    render(<Toolbar editor={makeMockEditor()} onInsertImage={vi.fn()} />);

    const select = screen.getByTitle('Font family');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toContain('My Custom Font');
  });

  it('renders no toolbar at all when there is no editor (unrelated to fonts, guards the test harness)', () => {
    const { container } = render(<Toolbar editor={null} onInsertImage={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
