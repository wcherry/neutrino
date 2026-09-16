/**
 * A pasted value must survive the next keypress.
 *
 * Reported first as "sometimes when pasting, pressing the arrow key causes the
 * result under the cursor to disappear", then as "working for arrow, but not
 * Enter". Two separate defects in `activateCell`, one per cell involved:
 *
 *   - the cell being ACTIVATED was reverted, because the transition wrote back
 *     `raw` from an `existing` snapshot read before the paste landed;
 *   - the cell being LEFT was overwritten, because navigating away committed the
 *     formula bar's value — itself a snapshot taken at activation, which an
 *     external write never refreshes.
 *
 * Arrow and Enter both route through `activateCell`, so neither key was ever
 * really the variable; which of the two cells was hit depended on where the
 * cursor was when the paste landed.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, useState, useLayoutEffect } from 'react';
import { useCellEditing } from '../../app/(apps)/sheets/editor/hooks/useCellEditing';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function cell(id: string, raw: string, edit = false): CellProps {
    return { id, raw, value: raw, edit } as CellProps;
}

/** Drives the hook the way SheetEditor does, dataRef sync included. */
function useHarness(initial: Map<string, CellProps>) {
    const [data, setData] = useState(initial);
    const [currentCell, setCurrentCell] = useState<CellProps | undefined>();
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>();
    const [selectionActive, setSelectionActive] = useState<string | undefined>();
    const dataRef = useRef(initial);
    const dirtyRef = useRef(false);
    const snapshotBeforeEditRef = useRef<Map<string, CellProps> | null>(null);

    // SheetEditor.tsx:267 — dataRef follows committed state synchronously.
    useLayoutEffect(() => { dataRef.current = data; }, [data]);

    const editing = useCellEditing({
        data,
        setData,
        dataRef,
        currentCell,
        setCurrentCell,
        selectionAnchor,
        selectionActive,
        setSelectionAnchor,
        setSelectionActive,
        dirtyRef,
        pushToUndo: () => {},
        snapshotBeforeEditRef,
    });

    return { data, setData, dataRef, currentCell, editing };
}

describe('activateCell — the cell being activated', () => {
    it('does not revert a value written after activateCell read dataRef', async () => {
        const initial = new Map([['A1', cell('A1', '')], ['A2', cell('A2', '')]]);
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.setData(new Map([
                ['A1', cell('A1', '100')],
                ['A2', cell('A2', '800')],
            ]));
        });

        // The stale window: a pending low-priority transition still holds the
        // pre-paste snapshot while committed state already has the pasted values.
        result.current.dataRef.current = initial;

        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });

        expect(result.current.data.get('A1')?.raw).toBe('100');
        expect(result.current.data.get('A2')?.raw).toBe('800');
    });

    it('still marks the activated cell as being edited', async () => {
        const initial = new Map([['A1', cell('A1', '42')]]);
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });

        expect(result.current.data.get('A1')?.edit).toBe(true);
        expect(result.current.data.get('A1')?.raw).toBe('42');
    });

    it('activates a cell that is not in the map at all', async () => {
        const { result } = renderHook(() => useHarness(new Map()));

        await act(async () => {
            result.current.editing.activateCellRef.current('C3');
        });

        expect(result.current.data.get('C3')?.edit).toBe(true);
        expect(result.current.data.get('C3')?.raw).toBe('');
    });
});

describe('activateCell — the cell being left', () => {
    it('does not write a stale formula-bar value over a cell the paste rewrote', async () => {
        const initial = new Map([['A1', cell('A1', '')]]);
        const { result } = renderHook(() => useHarness(initial));

        // Select A1. Activation snapshots its raw ('') into currentCell, which is
        // what the formula bar renders, and marks the cell as being edited.
        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });
        expect(result.current.currentCell?.raw).toBe('');

        // A paste rewrites A1 under the cursor. currentCell is never refreshed,
        // and the activation leaves edit: true on the cell.
        await act(async () => {
            const pasted = new Map(result.current.data);
            pasted.set('A1', cell('A1', '100', true));
            result.current.setData(pasted);
        });

        // Enter (or an arrow) — navigate to A2, committing A1 on the way out.
        await act(async () => {
            result.current.editing.activateCellRef.current('A2');
        });

        expect(result.current.data.get('A1')?.raw).toBe('100');
        expect(result.current.data.get('A1')?.value).toBe('100');
    });

    it('still commits what the user actually typed', async () => {
        const initial = new Map([['A1', cell('A1', '')]]);
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });

        await act(async () => {
            result.current.editing.beginTypingInFormulaBar('42');
        });

        await act(async () => {
            result.current.editing.activateCellRef.current('A2');
        });

        expect(result.current.data.get('A1')?.raw).toBe('42');
    });

    it('commits a typed formula and its computed value', async () => {
        const initial = new Map([['A1', cell('A1', '2')], ['A2', cell('A2', '3')]]);
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.editing.activateCellRef.current('A3');
        });

        await act(async () => {
            result.current.editing.beginTypingInFormulaBar('=SUM(A1:A2)');
        });

        await act(async () => {
            result.current.editing.activateCellRef.current('A4');
        });

        expect(result.current.data.get('A3')?.raw).toBe('=SUM(A1:A2)');
        expect(result.current.data.get('A3')?.value).toBe('5');
    });
});
