/**
 * The Drawing style panel's font-family picker.
 *
 * Unlike the other four editors, Drawing keeps its own bespoke built-in
 * `FONT_FAMILIES` array — it includes the generic `sans-serif`/`serif`/
 * `monospace` entries the others do not — and *appends*
 * `useAvailableFonts().customFontFamilies` to it rather than replacing the list
 * the way Docs, Slides and Sheets do. That is the property this pins down: a
 * custom font must reach the picker without displacing the built-ins.
 *
 * Text is a **layer** in the document model, not a shape inside one, so the
 * picker appears when a text *node* is selected. Selecting a vector object
 * shows fill and stroke instead, and no font control at all.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

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
import { createDocument, createRect, createTextLayer } from '../../app/(apps)/drawing/editor/document/factory';
import { addNode, addObjects } from '../../app/(apps)/drawing/editor/document/edits';
import { flattenTree } from '../../app/(apps)/drawing/editor/document/tree';
import { DEFAULT_VECTOR_STYLE } from '../../app/(apps)/drawing/editor/document/factory';
import { createBrush } from '../../app/(apps)/drawing/editor/paint';
import type { DrawingDocument, Selection } from '../../app/(apps)/drawing/editor/types';

// Drawing's own bespoke built-in list (mirrors the private FONT_FAMILIES const
// at the top of StylePanel.tsx — kept in sync here deliberately, since it is
// not exported).
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

/** A document holding one text layer, and the selection that picks it. */
function withTextLayer(): { doc: DrawingDocument; selection: Selection } {
  const base = createDocument();
  const layer = createTextLayer({ x: 0, y: 0, width: 200, height: 40 }, 'Hello');
  return { doc: addNode(base, layer), selection: { kind: 'nodes', ids: [layer.id] } };
}

/** A document holding one rectangle, and the selection that picks it. */
function withRect(): { doc: DrawingDocument; selection: Selection } {
  const base = createDocument();
  const vectorLayer = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
  const rect = createRect({ x: 0, y: 0, width: 40, height: 40 });
  return {
    doc: addObjects(base, vectorLayer.id, [rect]),
    selection: { kind: 'objects', layerId: vectorLayer.id, ids: [rect.id] },
  };
}

function renderPanel({ doc, selection }: { doc: DrawingDocument; selection: Selection }) {
  return render(
    <StylePanel
      doc={doc}
      onDocumentChange={vi.fn()}
      selection={selection}
      newObjectStyle={DEFAULT_VECTOR_STYLE}
      onNewObjectStyleChange={vi.fn()}
      // The panel shows the brush settings instead whenever a paint tool is
      // armed, so the tool has to be a non-paint one for the font picker to be
      // on screen at all — which is itself part of what these tests assert.
      tool="select"
      brush={createBrush('brush')}
      onBrushChange={vi.fn()}
      maskEditing={false}
      onMaskEditingChange={vi.fn()}
      activeLayerId=""
    />,
  );
}

function fontSelect(): HTMLSelectElement {
  return screen.getByLabelText('Font family') as HTMLSelectElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drawing StylePanel — font-family picker', () => {
  it('renders an option for every built-in font when a text layer is selected', () => {
    renderPanel(withTextLayer());

    const labels = Array.from(fontSelect().querySelectorAll('option')).map((o) => o.textContent);
    for (const font of DRAWING_BUILTIN_FONTS) {
      expect(labels).toContain(font.label);
    }
  });

  it('appends a custom font from useAvailableFonts to the built-in list', () => {
    renderPanel(withTextLayer());

    const labels = Array.from(fontSelect().querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('My Custom Font');
    // Appended, not substituted: the built-ins are still there and still first.
    expect(labels.slice(0, DRAWING_BUILTIN_FONTS.length))
      .toEqual(DRAWING_BUILTIN_FONTS.map((f) => f.label));
  });

  it('shows no font picker for a vector object', () => {
    renderPanel(withRect());

    expect(screen.queryByLabelText('Font family')).toBeNull();
    // …and does show the controls a shape actually has.
    expect(screen.queryByLabelText('Stroke width')).not.toBeNull();
  });
});
