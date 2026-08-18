/**
 * The header-selection model behind issue #63 — selecting more than one row or
 * column header. The three gestures the editor exposes (plain click, Cmd/Ctrl
 * click, Shift click / drag) all funnel through `selectHeader` and
 * `extendHeaderSelection`, so these are the rules the grid actually obeys.
 */

import { describe, it, expect } from 'vitest';
import {
    selectHeader,
    extendHeaderSelection,
    headerRuns,
    headerSelectionLabel,
    headerSelectionCellBounds,
    headerSelectionCells,
    type HeaderSelection,
} from '../../app/(apps)/sheets/editor/headerSelection';
import { MAX_ROWS, MAX_COLS } from '../../app/(apps)/sheets/editor/constants';

function click(current: HeaderSelection | null, index: number, mods = {}): HeaderSelection {
    return selectHeader(current, 'col', index, mods);
}

describe('selectHeader', () => {
    it('starts a selection from nothing', () => {
        expect(click(null, 2).indices).toEqual([2]);
    });

    it('replaces the selection on a plain click', () => {
        const first = click(null, 2);
        expect(click(first, 5).indices).toEqual([5]);
    });

    it('adds a header on Cmd/Ctrl click, keeping the indices ascending', () => {
        let sel = click(null, 5);
        sel = click(sel, 2, { toggle: true });
        sel = click(sel, 8, { toggle: true });
        expect(sel.indices).toEqual([2, 5, 8]);
    });

    it('removes an already-selected header on Cmd/Ctrl click', () => {
        let sel = click(null, 2);
        sel = click(sel, 4, { toggle: true });
        sel = click(sel, 6, { toggle: true });
        expect(click(sel, 4, { toggle: true }).indices).toEqual([2, 6]);
    });

    it('keeps the last header when Cmd/Ctrl clicking it — a selection is never empty', () => {
        const sel = click(null, 3);
        expect(click(sel, 3, { toggle: true }).indices).toEqual([3]);
    });

    it('selects the whole span on Shift click, in either direction', () => {
        const sel = click(null, 5);
        expect(selectHeader(sel, 'col', 8, { extend: true }).indices).toEqual([5, 6, 7, 8]);
        expect(selectHeader(sel, 'col', 2, { extend: true }).indices).toEqual([2, 3, 4, 5]);
    });

    it('starts over when the click lands on the other axis', () => {
        const cols = click(null, 4);
        const rows = selectHeader(cols, 'row', 1, { toggle: true });
        expect(rows).toEqual({ axis: 'row', indices: [1], anchor: 1, before: [] });
    });
});

describe('extendHeaderSelection', () => {
    it('re-derives the dragged run from the anchor rather than accumulating it', () => {
        const sel = click(null, 3);
        // A drag out to 7 and back to 5 leaves 3–5 selected, not 3–7.
        const out = extendHeaderSelection(sel, 7);
        expect(extendHeaderSelection(out, 5).indices).toEqual([3, 4, 5]);
    });

    it('preserves headers added by an earlier Cmd/Ctrl click', () => {
        let sel = click(null, 1);
        sel = click(sel, 5, { toggle: true });   // anchor moves to 5, keeping 1
        sel = extendHeaderSelection(sel, 7);
        expect(sel.indices).toEqual([1, 5, 6, 7]);
        // Dragging back does not eat the Cmd-clicked header.
        expect(extendHeaderSelection(sel, 5).indices).toEqual([1, 5]);
    });

    it('drops the headers a Cmd/Ctrl deselect removed', () => {
        let sel = click(null, 2);
        sel = click(sel, 3, { toggle: true });
        sel = click(sel, 3, { toggle: true });   // 3 removed again
        expect(extendHeaderSelection(sel, 2).indices).toEqual([2]);
    });
});

describe('headerRuns', () => {
    it('splits indices into contiguous blocks', () => {
        expect(headerRuns([2, 3, 4, 7, 9, 10])).toEqual([
            { start: 2, end: 4 },
            { start: 7, end: 7 },
            { start: 9, end: 10 },
        ]);
    });

    it('is empty for an empty selection', () => {
        expect(headerRuns([])).toEqual([]);
    });
});

describe('headerSelectionLabel', () => {
    it('names a single column and a single row', () => {
        expect(headerSelectionLabel({ axis: 'col', indices: [2], anchor: 2, before: [] })).toBe('C');
        expect(headerSelectionLabel({ axis: 'row', indices: [2], anchor: 2, before: [] })).toBe('3');
    });

    it('ranges a contiguous block', () => {
        expect(headerSelectionLabel({ axis: 'col', indices: [2, 3, 4], anchor: 2, before: [] })).toBe('C:E');
        expect(headerSelectionLabel({ axis: 'row', indices: [4, 5], anchor: 4, before: [] })).toBe('5:6');
    });

    it('lists the blocks of a non-contiguous selection', () => {
        expect(headerSelectionLabel({ axis: 'col', indices: [2, 3, 6], anchor: 6, before: [] })).toBe('C:D, G');
    });
});

describe('headerSelectionCellBounds', () => {
    it('spans the full sheet along the selected axis', () => {
        expect(headerSelectionCellBounds({ axis: 'col', indices: [2, 4], anchor: 2, before: [] }))
            .toEqual({ anchor: 'C1', active: `E${MAX_ROWS}` });
        expect(headerSelectionCellBounds({ axis: 'row', indices: [0, 2], anchor: 0, before: [] }).anchor)
            .toBe('A1');
    });
});

describe('headerSelectionCells', () => {
    it('covers exactly the selected columns, gaps included', () => {
        const cells = headerSelectionCells({ axis: 'col', indices: [0, 2], anchor: 0, before: [] });
        expect(cells.size).toBe(2 * MAX_ROWS);
        expect(cells.has('A1')).toBe(true);
        expect(cells.has(`C${MAX_ROWS}`)).toBe(true);
        // B is the gap a Cmd+click left — it must not be swept up by the
        // bounding box the anchor/active pair describes.
        expect(cells.has('B1')).toBe(false);
    });

    it('covers exactly the selected rows', () => {
        const cells = headerSelectionCells({ axis: 'row', indices: [0, 4], anchor: 0, before: [] });
        expect(cells.size).toBe(2 * MAX_COLS);
        expect(cells.has('A1')).toBe(true);
        expect(cells.has('B5')).toBe(true);
        expect(cells.has('A2')).toBe(false);
    });
});
