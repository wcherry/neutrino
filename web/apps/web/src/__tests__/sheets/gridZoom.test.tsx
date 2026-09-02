/**
 * Issue #74: the sheets editor gained the common zoom control, implemented as a
 * CSS `zoom` on the scroll area. Everything the grid computes stays in its own
 * unzoomed pixels, so the one thing zoom can break is a mouse drag: `clientX` is
 * a viewport coordinate, and the column width it feeds is a grid coordinate.
 *
 * These pin the conversion down — at 200% a 40px drag has to widen the column by
 * 20, not 40, or the edge runs away from the pointer.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { SheetGrid, type SheetGridProps } from '../../app/(apps)/sheets/editor/SheetGrid';
import { SheetZoomProvider } from '../../app/(apps)/sheets/editor/zoom';
import { CELL_W, CELL_H } from '../../app/(apps)/sheets/editor/constants';

function renderGrid(scale: number | null, overrides: Partial<SheetGridProps> = {}) {
    const props: SheetGridProps = {
        data: new Map(),
        selectedCells: new Set<string>(),
        onCellActivate: vi.fn(),
        onSelectionExtend: vi.fn(),
        colWidths: new Map(),
        rowHeights: new Map(),
        onColResize: vi.fn(),
        onRowResize: vi.fn(),
        ...overrides,
    };
    const grid = <SheetGrid {...props} />;
    const { container } = render(
        scale === null ? grid : <SheetZoomProvider scale={scale}>{grid}</SheetZoomProvider>,
    );
    return container;
}

function dragColEdge(container: HTMLElement, colIndex: number, dx: number) {
    const header = container.querySelector(`[data-col-header="${colIndex}"]`) as HTMLElement;
    const handle = header.querySelector('[class*="colResizeHandle"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 300 + dx });
    fireEvent.mouseUp(document, { clientX: 300 + dx });
}

function dragRowEdge(container: HTMLElement, rowIndex: number, dy: number) {
    const header = container.querySelector(`[data-row-header="${rowIndex}"]`) as HTMLElement;
    const handle = header.querySelector('[class*="rowResizeHandle"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientY: 200 });
    fireEvent.mouseMove(document, { clientY: 200 + dy });
    fireEvent.mouseUp(document, { clientY: 200 + dy });
}

describe('SheetGrid resize drags under zoom', () => {
    it('takes the pointer delta as-is with no zoom provider', () => {
        const onColResize = vi.fn();
        dragColEdge(renderGrid(null, { onColResize }), 1, 40);
        expect(onColResize).toHaveBeenCalledWith(1, CELL_W + 40);
    });

    it('takes the pointer delta as-is at 100%', () => {
        const onColResize = vi.fn();
        dragColEdge(renderGrid(1, { onColResize }), 1, 40);
        expect(onColResize).toHaveBeenCalledWith(1, CELL_W + 40);
    });

    it('converts a column drag out of screen pixels when zoomed in', () => {
        const onColResize = vi.fn();
        dragColEdge(renderGrid(2, { onColResize }), 1, 40);
        expect(onColResize).toHaveBeenCalledWith(1, CELL_W + 20);
    });

    it('converts a column drag out of screen pixels when zoomed out', () => {
        const onColResize = vi.fn();
        dragColEdge(renderGrid(0.5, { onColResize }), 1, 40);
        expect(onColResize).toHaveBeenCalledWith(1, CELL_W + 80);
    });

    it('converts a row drag the same way', () => {
        const onRowResize = vi.fn();
        dragRowEdge(renderGrid(2, { onRowResize }), 3, 40);
        expect(onRowResize).toHaveBeenCalledWith(3, CELL_H + 20);
    });
});
