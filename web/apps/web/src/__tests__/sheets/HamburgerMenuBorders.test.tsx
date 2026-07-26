/**
 * TDD red-phase tests for HamburgerMenu.tsx's Format -> Borders submenu
 * (~line 213-218 today).
 *
 * Today each of the 4 border actions calls `onStyleChange` with ONLY
 * `borderStyle` set, e.g. `onStyleChange({ borderStyle: 'thin' })`. This is a
 * bug once per-side borders exist: if a cell previously had e.g.
 * `borderTop: 'thick'` set directly (via the new per-side feature), applying
 * a uniform "Thin" border via this menu would leave the stale `borderTop:
 * 'thick'` in place, and Cell.tsx's new rendering rule ("if ANY of the 4 side
 * fields is defined, render per-side and ignore borderStyle entirely") means
 * the stale directional border would silently keep winning over the new
 * uniform border the user just chose.
 *
 * The fix (not yet implemented): each of the 4 Borders actions must call
 * `onStyleChange` with the existing `borderStyle` value PLUS all 4 side
 * fields explicitly reset to `undefined`, in the same call, e.g.
 * `onStyleChange({ borderStyle: 'thin', borderTop: undefined, borderRight:
 * undefined, borderBottom: undefined, borderLeft: undefined })`.
 *
 * This uses the exact same real (unmocked) `@neutrino/ui` HamburgerMenu
 * primitive interaction pattern as HamburgerMenuCategories.test.tsx: submenu
 * rows reveal their nested panel on `mouseEnter`, not on click, so opening
 * "Borders" (nested under "Format") requires hovering "Format" and then
 * hovering "Borders" before its action buttons are queryable.
 *
 * IMPORTANT: `expect.objectContaining({ borderTop: undefined, ... })` is
 * verified (see repo scratch investigation) to correctly FAIL when the key
 * is entirely absent from the actual call object — vitest/jest's
 * `objectContaining` checks `hasOwnProperty` per probed key, it does not
 * treat "missing key" and "key present but undefined" as equivalent. So this
 * assertion style correctly distinguishes today's buggy
 * `{ borderStyle: 'thin' }` call from the fixed one.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HamburgerMenu } from '../../app/(apps)/sheets/editor/components/HamburgerMenu';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

type Props = React.ComponentProps<typeof HamburgerMenu>;

function baseProps(overrides: Partial<Props> = {}): Props {
    return {
        onOpenCsvExport: vi.fn(),
        onOpenXlsxExport: vi.fn(),
        onOpenHtmlExport: vi.fn(),
        onOpenPrint: vi.fn(),
        onSave: vi.fn(),
        onToggleHistory: vi.fn(),
        setHamburgerDialog: vi.fn(),
        setHamburgerDeleteConfirm: vi.fn(),
        isViewer: false,

        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: true,
        canRedo: true,
        onCut: vi.fn(),
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onSelectAll: vi.fn(),
        onOpenFindReplace: vi.fn(),

        cellStyle: undefined as CellStyle | undefined,
        onStyleChange: vi.fn(),
        formatDisabled: false,
        isMerged: false,
        onMergeCells: vi.fn(),
        ...overrides,
    } as Props;
}

function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
}

function hoverLabel(label: string) {
    const labelEl = screen.getByText(label);
    const row = labelEl.closest('div');
    if (!row) throw new Error(`could not find hoverable row for "${label}"`);
    fireEvent.mouseEnter(row);
}

function openBordersSubmenu() {
    openMenu();
    hoverLabel('Format');
    hoverLabel('Borders');
}

describe('sheets HamburgerMenu — Format > Borders (stale directional-border fix)', () => {
    it.each<['No border' | 'Thin' | 'Medium' | 'Thick', CellStyle['borderStyle']]>([
        ['No border', 'none'],
        ['Thin', 'thin'],
        ['Medium', 'medium'],
        ['Thick', 'thick'],
    ])('"%s" calls onStyleChange with borderStyle %s AND all 4 side fields reset to undefined in the same call', (label, expectedBorderStyle) => {
        const props = baseProps();
        render(<HamburgerMenu {...props} />);
        openBordersSubmenu();

        fireEvent.click(screen.getByRole('button', { name: label }));

        expect(props.onStyleChange).toHaveBeenCalledTimes(1);
        expect(props.onStyleChange).toHaveBeenCalledWith(
            expect.objectContaining({
                borderStyle: expectedBorderStyle,
                borderTop: undefined,
                borderRight: undefined,
                borderBottom: undefined,
                borderLeft: undefined,
            })
        );
    });
});
