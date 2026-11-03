/**
 * What a copied or embedded drawing selection draws: which layers are hidden
 * and where the picture is cropped. Pure — the rendering is `renderDocument`'s,
 * which has its own tests.
 */

import { describe, it, expect } from 'vitest';
import {
  createDocument,
  createRect,
  createStack,
  createVectorLayer,
} from '@/app/(apps)/drawing/editor/document/factory';
import { insertNode, findNode } from '@/app/(apps)/drawing/editor/document/tree';
import type { DrawingDocument } from '@/app/(apps)/drawing/editor/document/types';
import { selectionRender } from '@/app/(apps)/drawing/editor/io/selectionImage';

/** Unstroked, so a rect's bounds are its frame — a stroke widens them by half its width. */
const rect = (frame: { x: number; y: number; width: number; height: number }) => createRect(frame, { strokeWidth: 0, stroke: 'none' });

function fixture() {
  let doc: DrawingDocument = createDocument();
  const a = rect({ x: 10, y: 20, width: 30, height: 40 });
  const b = rect({ x: 200, y: 200, width: 10, height: 10 });
  const layer = createVectorLayer('Shapes', { objects: [a, b] });
  const group = createStack('Group');
  const inner = createVectorLayer('Inner', { objects: [rect({ x: 100, y: 100, width: 50, height: 25 })] });
  const other = createVectorLayer('Other', { objects: [rect({ x: 0, y: 0, width: 5, height: 5 })] });
  doc = { ...doc, root: insertNode(doc.root, layer) };
  doc = { ...doc, root: insertNode(doc.root, group) };
  doc = { ...doc, root: insertNode(doc.root, inner, { parentId: group.id }) };
  doc = { ...doc, root: insertNode(doc.root, other) };
  return { doc, a, b, layer, group, inner, other };
}

describe('selectionRender', () => {
  it('crops to the selected objects and draws only them', () => {
    const { doc, a, b, layer, other, group, inner } = fixture();
    const plan = selectionRender(doc, { kind: 'objects', layerId: layer.id, ids: [a.id] })!;

    expect(plan.bounds).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    const kept = findNode(plan.doc.root, layer.id);
    expect(kept?.type === 'vector' && kept.objects.map((o) => o.id)).toEqual([a.id]);
    expect(plan.skipNodeIds.has(layer.id)).toBe(false);
    // Everything else is skipped — the document's own starting layer as well as these.
    expect([...plan.skipNodeIds]).toEqual(expect.arrayContaining([other.id, group.id, inner.id]));
    // The source document is untouched: the embed and the editor share it.
    const source = findNode(doc.root, layer.id);
    expect(source?.type === 'vector' && source.objects.map((o) => o.id)).toEqual([a.id, b.id]);
  });

  it('brings a selected group’s whole subtree', () => {
    const { doc, group, inner, layer, other } = fixture();
    const plan = selectionRender(doc, { kind: 'nodes', ids: [group.id] })!;

    expect(plan.bounds).toEqual({ x: 100, y: 100, width: 50, height: 25 });
    expect(plan.skipNodeIds.has(group.id)).toBe(false);
    expect(plan.skipNodeIds.has(inner.id)).toBe(false);
    expect([...plan.skipNodeIds]).toEqual(expect.arrayContaining([layer.id, other.id]));
  });

  it('keeps the ancestors of a selected nested layer, so their transforms still apply', () => {
    const { doc, group, inner } = fixture();
    const plan = selectionRender(doc, { kind: 'nodes', ids: [inner.id] })!;
    expect(plan.skipNodeIds.has(group.id)).toBe(false);
  });

  it('is null once what was selected is gone, which the embed reports instead of drawing nothing', () => {
    const { doc, layer } = fixture();
    expect(selectionRender(doc, { kind: 'nodes', ids: ['deleted'] })).toBeNull();
    expect(selectionRender(doc, { kind: 'objects', layerId: layer.id, ids: ['deleted'] })).toBeNull();
    expect(selectionRender(doc, { kind: 'objects', layerId: 'deleted', ids: ['x'] })).toBeNull();
  });

  it('includes the stroke, which is drawn outside the frame', () => {
    let doc = createDocument();
    const r = createRect({ x: 10, y: 10, width: 20, height: 20 }, { strokeWidth: 4 });
    const layer = createVectorLayer('L', { objects: [r] });
    doc = { ...doc, root: insertNode(doc.root, layer) };
    expect(selectionRender(doc, { kind: 'objects', layerId: layer.id, ids: [r.id] })!.bounds)
      .toEqual({ x: 8, y: 8, width: 24, height: 24 });
  });

  it('rounds the crop outwards to whole pixels', () => {
    let doc = createDocument();
    const r = rect({ x: 1.5, y: 2.25, width: 3.1, height: 4 });
    const layer = createVectorLayer('L', { objects: [r] });
    doc = { ...doc, root: insertNode(doc.root, layer) };
    expect(selectionRender(doc, { kind: 'objects', layerId: layer.id, ids: [r.id] })!.bounds)
      .toEqual({ x: 1, y: 2, width: 4, height: 5 });
  });
});
