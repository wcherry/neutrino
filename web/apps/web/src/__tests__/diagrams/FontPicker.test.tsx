/**
 * Component test for the Diagrams PropertiesPanel's font-family picker
 * (feature/custom-fonts plan, ~PropertiesPanel.tsx ShapeProperties
 * line 67-176 and MultiShapeProperties line 277-309).
 *
 * `ShapeStyle.fontFamily` (types.ts ~line 92-98) already exists as a field —
 * shapeUtils.ts hardcodes it to 'Inter' at shape-creation time, but no UI has
 * ever edited it. The plan adds a `<select>` font-family control to both
 * ShapeProperties (single shape selected) and MultiShapeProperties (multiple
 * shapes selected, bulk edit), bound to `style.fontFamily`, populated from
 * `useAvailableFonts().fontFamilyNames` (bare-name form, matching how
 * 'Inter' is used today).
 *
 * `ShapeProperties`/`MultiShapeProperties` are not exported directly, so
 * these tests render the exported `PropertiesPanel` with a `selection` that
 * exercises each internal branch.
 *
 * Red phase: `@/hooks/useAvailableFonts` does not exist yet, and
 * PropertiesPanel.tsx has no font-family control of any kind today, so every
 * assertion about a font <select> being present fails until
 * frontend-developer completes the wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { DiagramShape, DiagramPage, EditorSelection, ShapeStyle } from '../../app/(apps)/diagrams/types';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the component under test.
// ---------------------------------------------------------------------------

vi.mock('@neutrino/ui', () => ({
  ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../app/(apps)/diagrams/editor/PropertiesPanel.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

const CUSTOM_FONT_OPTION = { label: 'My Custom Font', value: 'My Custom Font' };

vi.mock('@/hooks/useAvailableFonts', () => ({
  useAvailableFonts: () => ({
    fontFamilies: [],
    fontFamilyNames: [{ label: 'Default (Inter)', value: 'Inter' }, CUSTOM_FONT_OPTION],
    customFontFamilies: [],
    customFontFamilyNames: [CUSTOM_FONT_OPTION],
    loaded: true,
  }),
}));

import { PropertiesPanel } from '../../app/(apps)/diagrams/editor/PropertiesPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStyle(overrides: Partial<ShapeStyle> = {}): ShapeStyle {
  return {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
    fontSize: 14,
    fontFamily: 'Inter',
    textColor: '#000000',
    opacity: 1,
    ...overrides,
  };
}

function makeShape(overrides: Partial<DiagramShape> = {}): DiagramShape {
  return {
    id: 'shape-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    label: 'Box',
    style: makeStyle(),
    ...overrides,
  };
}

function makePage(shapes: DiagramShape[]): DiagramPage {
  return {
    id: 'page-1',
    name: 'Page 1',
    shapes,
    connectors: [],
  };
}

function makeSelection(shapeIds: string[]): EditorSelection {
  return { shapeIds: new Set(shapeIds), connectorIds: new Set() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Diagrams PropertiesPanel — font-family picker (feature/custom-fonts)', () => {
  describe('single shape selected (ShapeProperties)', () => {
    it('renders a font-family select bound to the shape style', () => {
      const shape = makeShape();
      const page = makePage([shape]);

      render(
        <PropertiesPanel
          selection={makeSelection([shape.id])}
          page={page}
          onShapeUpdate={vi.fn()}
          onConnectorUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Font family')).toBeInTheDocument();
    });

    it('includes an option for a custom font returned by useAvailableFonts', () => {
      const shape = makeShape();
      const page = makePage([shape]);

      render(
        <PropertiesPanel
          selection={makeSelection([shape.id])}
          page={page}
          onShapeUpdate={vi.fn()}
          onConnectorUpdate={vi.fn()}
        />
      );

      const select = screen.getByDisplayValue('Default (Inter)').closest('select') as HTMLSelectElement;
      const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(optionLabels).toContain('My Custom Font');
    });

    it('calls onShapeUpdate with the new fontFamily merged into style', () => {
      const shape = makeShape();
      const page = makePage([shape]);
      const onShapeUpdate = vi.fn();

      render(
        <PropertiesPanel
          selection={makeSelection([shape.id])}
          page={page}
          onShapeUpdate={onShapeUpdate}
          onConnectorUpdate={vi.fn()}
        />
      );

      const select = screen.getByDisplayValue('Default (Inter)').closest('select') as HTMLSelectElement;
      select.dispatchEvent(new Event('focusin', { bubbles: true }));
      (select as HTMLSelectElement).value = 'My Custom Font';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onShapeUpdate).toHaveBeenCalledWith(
        shape.id,
        expect.objectContaining({ style: expect.objectContaining({ fontFamily: 'My Custom Font' }) })
      );
    });
  });

  describe('multiple shapes selected (MultiShapeProperties)', () => {
    it('renders a font-family select for bulk editing', () => {
      const shapeA = makeShape({ id: 'shape-a' });
      const shapeB = makeShape({ id: 'shape-b' });
      const page = makePage([shapeA, shapeB]);

      render(
        <PropertiesPanel
          selection={makeSelection(['shape-a', 'shape-b'])}
          page={page}
          onShapeUpdate={vi.fn()}
          onConnectorUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Font family')).toBeInTheDocument();
    });

    it('includes an option for a custom font returned by useAvailableFonts', () => {
      const shapeA = makeShape({ id: 'shape-a' });
      const shapeB = makeShape({ id: 'shape-b' });
      const page = makePage([shapeA, shapeB]);

      render(
        <PropertiesPanel
          selection={makeSelection(['shape-a', 'shape-b'])}
          page={page}
          onShapeUpdate={vi.fn()}
          onConnectorUpdate={vi.fn()}
        />
      );

      const select = screen.getByDisplayValue('Default (Inter)').closest('select') as HTMLSelectElement;
      const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(optionLabels).toContain('My Custom Font');
    });
  });
});
