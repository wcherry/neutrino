/**
 * Escape should dismiss the formula-bar function suggestion list without
 * exiting the current cell edit or discarding the in-progress formula text.
 *
 * Previously, Escape in the formula bar only reset formula-pick mode
 * (used for inserting cell references) — it never touched showFunctions /
 * showAllFunctions, so the autocomplete dropdown stayed open.
 */

import { useRef, useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCellEditing } from '../../app/(apps)/sheets/editor/hooks/useCellEditing';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function fakeKeyEvent(key: string) {
    return {
        key,
        preventDefault: () => {},
        stopPropagation: () => {},
    } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

function fakeChangeEvent(value: string) {
    return {
        target: { value },
        stopPropagation: () => {},
    } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function setup(initialRaw: string) {
    return renderHook(() => {
        const [data, setData] = useState<Map<string, CellProps>>(new Map([
            ['A1', { id: 'A1', raw: initialRaw, value: initialRaw, edit: true }],
        ]));
        const dataRef = useRef(data);
        dataRef.current = data;
        const [currentCell, setCurrentCell] = useState<CellProps | undefined>(data.get('A1'));
        const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>('A1');
        const [selectionActive, setSelectionActive] = useState<string | undefined>('A1');
        const dirtyRef = useRef(false);
        const snapshotBeforeEditRef = useRef<Map<string, CellProps> | null>(null);
        const editing = useCellEditing({
            data, setData, dataRef, currentCell, setCurrentCell,
            selectionAnchor, selectionActive, setSelectionAnchor, setSelectionActive,
            dirtyRef, pushToUndo: () => {}, snapshotBeforeEditRef,
        });
        return { ...editing, currentCell };
    });
}

describe('Escape in the formula bar dismisses the function suggestion list', () => {
    it('closes the typing-triggered dropdown (showFunctions) without discarding the formula', () => {
        const { result } = setup('=SU');
        act(() => { result.current.handleTextChange(fakeChangeEvent('=SU')); });
        expect(result.current.showFunctions).toBe(true);

        act(() => { result.current.handleFormulaBarKeyDown(fakeKeyEvent('Escape')); });

        expect(result.current.showFunctions).toBe(false);
        // The in-progress formula text is untouched — only the dropdown closed.
        expect(result.current.currentCell?.raw).toBe('=SU');
    });

    it('closes the "all functions" panel (showAllFunctions)', () => {
        const { result } = setup('');
        act(() => { result.current.toggleAllFunctions(); });
        expect(result.current.showAllFunctions).toBe(true);

        act(() => { result.current.handleFormulaBarKeyDown(fakeKeyEvent('Escape')); });

        expect(result.current.showAllFunctions).toBe(false);
    });

    it('still resets formula-pick mode on Escape when no list is visible', () => {
        const { result } = setup('=SUM(');
        act(() => { result.current.handleFormulaBarFocus(); });
        expect(result.current.formulaPickMode).toBe(true);
        expect(result.current.showFunctions).toBe(false);

        act(() => { result.current.handleFormulaBarKeyDown(fakeKeyEvent('Escape')); });

        expect(result.current.formulaPickMode).toBe(false);
    });
});
