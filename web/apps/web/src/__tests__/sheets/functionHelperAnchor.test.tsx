/**
 * The formula helper hangs off the cell being edited, not the formula bar.
 *
 * Covers:
 *   - Anchored under the edited cell's grid element
 *   - Falls back to the formula bar when that cell is scrolled out of the
 *     virtualised grid (no DOM node)
 *   - Flips above the anchor when there is no room below
 *   - Clamped inside the viewport horizontally
 *   - Picking a function still calls onFunctionSelect from inside the portal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { FormulaBar } from '../../app/(apps)/sheets/editor/components/FormulaBar';
import { computeHelperPosition } from '../../app/(apps)/sheets/editor/components/FunctionHelper';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

const VIEWPORT = { width: 1200, height: 800 };

/** Adds a grid-cell element with the given id and a stubbed rect. */
function placeCell(id: string, rect: { top: number; left: number; width: number; height: number }) {
    const el = document.createElement('div');
    el.id = id;
    el.getBoundingClientRect = () => ({
        top: rect.top,
        left: rect.left,
        bottom: rect.top + rect.height,
        right: rect.left + rect.width,
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(el);
    return el;
}

function renderBar(currentCell: CellProps | undefined, onFunctionSelect = vi.fn()) {
    const utils = render(
        <FormulaBar
            addressDisplay={currentCell?.id ?? ''}
            currentCell={currentCell}
            showFunctions
            showAllFunctions={false}
            formulaPickMode={false}
            formulaInputRef={React.createRef<HTMLInputElement>() as React.RefObject<HTMLInputElement>}
            onTextChange={vi.fn()}
            onKeyDown={vi.fn()}
            onFocus={vi.fn()}
            onMouseDown={vi.fn()}
            onBlur={vi.fn()}
            onToggleAllFunctions={vi.fn()}
            onFunctionSelect={onFunctionSelect}
        />,
    );
    return { ...utils, onFunctionSelect };
}

describe('formula helper placement', () => {
    beforeEach(() => {
        window.innerWidth = VIEWPORT.width;
        window.innerHeight = VIEWPORT.height;
    });

    afterEach(() => {
        document.querySelectorAll('[id]').forEach(el => el.remove());
    });

    it('anchors under the cell being edited', () => {
        placeCell('B2', { top: 120, left: 180, width: 100, height: 24 });
        renderBar({ id: 'B2', raw: '=A', value: '', edit: true });

        const helper = screen.getByTestId('function-helper');
        // 120 + 24 (cell bottom) + 4 (gap)
        expect(helper.style.top).toBe('148px');
        expect(helper.style.left).toBe('180px');
    });

    it('falls back to the formula bar when the edited cell is scrolled out of the grid', () => {
        // No element with id "Z900" — the virtualised grid has not rendered it.
        renderBar({ id: 'Z900', raw: '=A', value: '', edit: true });

        const helper = screen.getByTestId('function-helper');
        // jsdom reports a zero rect for the formula input wrapper, so the helper
        // lands at the top-left — the point is that it still renders somewhere.
        expect(helper.style.top).toBe('4px');
        expect(helper.style.bottom).toBe('');
    });

    it('re-anchors when the grid scrolls', () => {
        const cell = placeCell('B2', { top: 120, left: 180, width: 100, height: 24 });
        renderBar({ id: 'B2', raw: '=A', value: '', edit: true });
        expect(screen.getByTestId('function-helper').style.top).toBe('148px');

        cell.getBoundingClientRect = () => ({ top: 60, left: 180, bottom: 84, right: 280, width: 100, height: 24, x: 180, y: 60, toJSON: () => ({}) }) as DOMRect;
        fireEvent.scroll(document, {});

        expect(screen.getByTestId('function-helper').style.top).toBe('88px');
    });

    it('selects a function from the portalled list', () => {
        placeCell('B2', { top: 120, left: 180, width: 100, height: 24 });
        const { onFunctionSelect } = renderBar({ id: 'B2', raw: '=AV', value: '', edit: true });

        fireEvent.mouseDown(screen.getByText('AVERAGE'));

        expect(onFunctionSelect).toHaveBeenCalledWith('AVERAGE');
    });
});

describe('computeHelperPosition', () => {
    it('opens downwards when there is room below', () => {
        const pos = computeHelperPosition({ top: 100, bottom: 124, left: 200 }, VIEWPORT);
        expect(pos).toEqual({ left: 200, top: 128, maxHeight: 280 });
    });

    it('flips above the anchor when the cell is near the bottom edge', () => {
        const pos = computeHelperPosition({ top: 740, bottom: 764, left: 200 }, VIEWPORT);
        // Bottom edge hugs the cell's top so the list grows upwards.
        expect(pos.top).toBeUndefined();
        expect(pos.bottom).toBe(VIEWPORT.height - 740 + 4);
        expect(pos.maxHeight).toBe(280);
    });

    it('clamps to the viewport so a right-hand cell does not overflow', () => {
        const pos = computeHelperPosition({ top: 100, bottom: 124, left: 1150 }, VIEWPORT);
        // 1200 - 440 (width) - 8 (margin)
        expect(pos.left).toBe(752);
    });

    it('never places the helper off the left edge', () => {
        const pos = computeHelperPosition({ top: 100, bottom: 124, left: 0 }, VIEWPORT);
        expect(pos.left).toBe(8);
    });
});
