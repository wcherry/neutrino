/**
 * The gesture half of issue #63: SheetGrid has to turn mouse activity on the
 * header tracks into select/extend calls, with the Cmd/Ctrl and Shift state
 * attached. The selection logic itself is covered by headerSelection.test.ts.
 *
 * Selection fires on mousedown rather than click, because a click only lands
 * after mouseup — by which time a drag across headers is already over.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { SheetGrid, type SheetGridProps } from '../../app/(apps)/sheets/editor/SheetGrid';
import { headerRuns } from '../../app/(apps)/sheets/editor/headerSelection';

function renderGrid(overrides: Partial<SheetGridProps> = {}) {
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
    const { container } = render(<SheetGrid {...props} />);
    return container;
}

const colHeader = (container: HTMLElement, index: number) =>
    container.querySelector(`[data-col-header="${index}"]`) as HTMLElement;
const rowHeader = (container: HTMLElement, index: number) =>
    container.querySelector(`[data-row-header="${index}"]`) as HTMLElement;

describe('SheetGrid header gestures', () => {
    let onColHeaderSelect: ReturnType<typeof vi.fn>;
    let onRowHeaderSelect: ReturnType<typeof vi.fn>;
    let onColHeaderExtendTo: ReturnType<typeof vi.fn>;
    let onRowHeaderExtendTo: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onColHeaderSelect = vi.fn();
        onRowHeaderSelect = vi.fn();
        onColHeaderExtendTo = vi.fn();
        onRowHeaderExtendTo = vi.fn();
    });

    function gridWithHandlers(overrides: Partial<SheetGridProps> = {}) {
        return renderGrid({
            onColHeaderSelect, onRowHeaderSelect, onColHeaderExtendTo, onRowHeaderExtendTo,
            ...overrides,
        });
    }

    it('reports a plain column header click with no modifiers', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(colHeader(container, 2), { button: 0 });
        expect(onColHeaderSelect).toHaveBeenCalledWith(2, { toggle: false, extend: false });
    });

    it('reports Cmd and Ctrl as a toggle', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(colHeader(container, 1), { button: 0, metaKey: true });
        fireEvent.mouseDown(colHeader(container, 3), { button: 0, ctrlKey: true });
        expect(onColHeaderSelect).toHaveBeenNthCalledWith(1, 1, { toggle: true, extend: false });
        expect(onColHeaderSelect).toHaveBeenNthCalledWith(2, 3, { toggle: true, extend: false });
    });

    it('reports Shift as an extend', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(rowHeader(container, 4), { button: 0, shiftKey: true });
        expect(onRowHeaderSelect).toHaveBeenCalledWith(4, { toggle: false, extend: true });
    });

    it('extends as a drag crosses column headers, and stops at mouseup', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(colHeader(container, 0), { button: 0 });
        fireEvent.mouseMove(colHeader(container, 1), { buttons: 1 });
        fireEvent.mouseMove(colHeader(container, 2), { buttons: 1 });
        expect(onColHeaderExtendTo.mock.calls.map(c => c[0])).toEqual([1, 2]);

        fireEvent.mouseUp(document);
        fireEvent.mouseMove(colHeader(container, 3), { buttons: 1 });
        expect(onColHeaderExtendTo).toHaveBeenCalledTimes(2);
    });

    it('extends as a drag crosses row headers', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(rowHeader(container, 0), { button: 0 });
        fireEvent.mouseMove(rowHeader(container, 2), { buttons: 1 });
        expect(onRowHeaderExtendTo).toHaveBeenCalledWith(2);
    });

    it('does not extend a column selection when the drag started on a row header', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(rowHeader(container, 0), { button: 0 });
        fireEvent.mouseMove(colHeader(container, 3), { buttons: 1 });
        expect(onColHeaderExtendTo).not.toHaveBeenCalled();
    });

    it('ignores a move with no button held — a hover is not a drag', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(colHeader(container, 1), { button: 0 });
        fireEvent.mouseMove(colHeader(container, 2), { buttons: 0 });
        expect(onColHeaderExtendTo).not.toHaveBeenCalled();
    });

    it('leaves the selection alone on a right click, so the context menu keeps it', () => {
        const container = gridWithHandlers();
        fireEvent.mouseDown(colHeader(container, 2), { button: 2 });
        expect(onColHeaderSelect).not.toHaveBeenCalled();
    });

    it('does not start a selection from the resize handle', () => {
        const container = gridWithHandlers();
        const handle = colHeader(container, 2).querySelector('div') as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0 });
        expect(onColHeaderSelect).not.toHaveBeenCalled();
    });
});

describe('SheetGrid header selection rendering', () => {
    it('marks every selected header, contiguous or not', () => {
        const container = renderGrid({
            headerSelection: { axis: 'col', indices: new Set([1, 3]), runs: headerRuns([1, 3]) },
        });
        const selectedClass = colHeader(container, 1).className;
        expect(selectedClass).not.toBe(colHeader(container, 2).className);
        expect(colHeader(container, 3).className).toBe(selectedClass);
    });

    it('tints the cells under the selected columns and skips the gap', () => {
        const container = renderGrid({
            headerSelection: { axis: 'col', indices: new Set([0, 2]), runs: headerRuns([0, 2]) },
        });
        const cellClass = (id: string) => (container.querySelector(`#${id}`) as HTMLElement).className;
        expect(cellClass('A1')).toBe(cellClass('C1'));
        expect(cellClass('B1')).not.toBe(cellClass('A1'));
    });

    it('tints the cells of the selected rows', () => {
        const container = renderGrid({
            headerSelection: { axis: 'row', indices: new Set([0]), runs: headerRuns([0]) },
        });
        const cellClass = (id: string) => (container.querySelector(`#${id}`) as HTMLElement).className;
        expect(cellClass('A1')).toBe(cellClass('B1'));
        expect(cellClass('A2')).not.toBe(cellClass('A1'));
    });
});
