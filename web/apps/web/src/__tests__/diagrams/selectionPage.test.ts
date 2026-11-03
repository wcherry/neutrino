/**
 * "The page, but only these shapes" — what a copied diagram selection draws,
 * and what a live embed of one draws, through the same function.
 */

import { describe, it, expect } from 'vitest';
import type { DiagramConnector, DiagramPage, DiagramShape } from '@/app/(apps)/diagrams/types';
import { selectionPage } from '@/app/(apps)/diagrams/editor/io/selectionImage';

const shape = (id: string) => ({ id }) as DiagramShape;
const connector = (id: string, sourceId: string | null, targetId: string | null) =>
  ({ id, sourceId, targetId }) as DiagramConnector;

const page: DiagramPage = {
  id: 'p1',
  name: 'Page 1',
  shapes: [shape('a'), shape('b'), shape('c')],
  connectors: [connector('ab', 'a', 'b'), connector('bc', 'b', 'c'), connector('loose', 'a', null)],
  strokes: [{ id: 'ink' } as never],
};

describe('selectionPage', () => {
  it('keeps the selected shapes and the connectors between two of them', () => {
    const out = selectionPage(page, ['a', 'b']);
    expect(out.shapes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out.connectors.map((c) => c.id)).toEqual(['ab']);
  });

  it('drops a connector with a loose end, which would point at nothing in the picture', () => {
    expect(selectionPage(page, ['a']).connectors).toEqual([]);
  });

  it('drops freehand strokes, which cannot be selected', () => {
    expect(selectionPage(page, ['a']).strokes).toEqual([]);
  });

  it('is the whole page for an embed with no selection — every embed made before this', () => {
    expect(selectionPage(page, null)).toBe(page);
    expect(selectionPage(page, [])).toBe(page);
  });
});
