/**
 * Activating a cell must not revert its value.
 *
 * Reported as "sometimes when pasting, pressing the arrow key causes the result
 * under the cursor to disappear".
 *
 * `activateCell` reads `existing` from `dataRef.current` at the top, then does
 * the real work inside a `startTransition`. A transition is low priority and
 * interruptible, so a paste — a discrete event — can land in between. The
 * transition's updater runs against `prevData`, which by then contains the
 * pasted values, but it was writing `raw: existing.raw` from the snapshot taken
 * *before* the paste. The pasted value was therefore reverted, and because the
 * pending transition is flushed by the next interaction, the content vanished
 * exactly when the user pressed an arrow key.
 *
 * The race is reproduced here by leaving `dataRef` on the pre-paste map while
 * `data` state carries the pasted values — which is precisely the window the
 * useLayoutEffect in SheetEditor has not yet closed.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useCellEditing } from '../../app/(apps)/sheets/editor/hooks/useCellEditing';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function cell(id: string, raw: string): CellProps {
    return { id, raw, value: raw, edit: false } as CellProps;
}

/**
 * Drives the hook the way SheetEditor does, but *without* the layout effect that
 * syncs dataRef — the test controls that by hand so the stale window is explicit.
 */
function useHarness(initial: Map<string, CellProps>) {
    const [data, setData] = useState(initial);
    const [currentCell, setCurrentCell] = useState<CellProps | undefined>();
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>();
    const [selectionActive, setSelectionActive] = useState<string | undefined>();
    const dataRef = useRef(initial);
    const dirtyRef = useRef(false);
    const snapshotBeforeEditRef = useRef<Map<string, CellProps> | null>(null);

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

describe('activateCell — a pasted value survives activation', () => {
    it('does not revert a value written after activateCell read dataRef', async () => {
        const initial = new Map<string, CellProps>([
            ['A1', cell('A1', '')],
            ['A2', cell('A2', '')],
        ]);

        const { result } = renderHook(() => useHarness(initial));

        // A paste lands in React state. dataRef is deliberately left on the old
        // map: that is the window between the paste committing and SheetEditor's
        // useLayoutEffect running, and the window a pending transition can fall in.
        await act(async () => {
            result.current.setData(new Map<string, CellProps>([
                ['A1', cell('A1', '100')],
                ['A2', cell('A2', '800')],
            ]));
        });

        expect(result.current.data.get('A1')?.raw).toBe('100');

        // Arrow onto A1 — the activation whose transition used to carry the stale raw.
        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });

        expect(result.current.data.get('A1')?.raw).toBe('100');
        expect(result.current.data.get('A2')?.raw).toBe('800');
    });

    it('still marks the activated cell as being edited', async () => {
        const initial = new Map<string, CellProps>([['A1', cell('A1', '42')]]);
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.editing.activateCellRef.current('A1');
        });

        expect(result.current.data.get('A1')?.edit).toBe(true);
        expect(result.current.data.get('A1')?.raw).toBe('42');
    });

    it('activates a cell that is not in the map at all', async () => {
        const initial = new Map<string, CellProps>();
        const { result } = renderHook(() => useHarness(initial));

        await act(async () => {
            result.current.editing.activateCellRef.current('C3');
        });

        expect(result.current.data.get('C3')?.edit).toBe(true);
        expect(result.current.data.get('C3')?.raw).toBe('');
    });
});
