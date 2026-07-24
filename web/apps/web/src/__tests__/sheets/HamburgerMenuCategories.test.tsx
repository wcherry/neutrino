/**
 * TDD red-phase tests for the planned reorganisation of the sheets editor's
 * HamburgerMenu.tsx from a flat item list into Docs-style top-level
 * categories (File / Edit / Format / Insert) that fly out submenus on
 * hover, mirroring the existing pattern in
 * `apps/web/src/app/(apps)/docs/editor/MenuBar.tsx`.
 *
 * The implementation does NOT exist yet — HamburgerMenu.tsx still renders a
 * flat list of items with no "Edit"/"Format"/"Insert" categories. These
 * tests are written against the *planned* Props interface and are expected
 * to fail until a separate task implements the new structure. That is
 * correct TDD red-phase behaviour.
 *
 * `@neutrino/ui`'s real `HamburgerMenu`/`HamburgerMenuItem` primitive
 * (packages/ui/src/components/navigation/HamburgerMenu.tsx) is NOT mocked
 * here — it's a small, dependency-free component. Per its implementation:
 *   - The trigger button has `aria-label="Open menu"`.
 *   - `kind: 'submenu'` items render as a row that reveals a nested panel
 *     `onMouseEnter` (not on click) — tests must `fireEvent.mouseEnter` on
 *     the row before a nested item becomes queryable/clickable.
 *   - `kind: 'action'` items render as `<button disabled={item.disabled}>`,
 *     and clicking one invokes `action()` then closes the whole menu.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HamburgerMenu } from '../../app/(apps)/sheets/editor/components/HamburgerMenu';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

// ── Props shape (planned) ──────────────────────────────────────────────────
// HamburgerMenu.tsx does not export its Props type, and the real component's
// current Props are a strict subset of this. We type our own local mirror of
// the planned interface purely so `baseProps()` below is self-documenting;
// vitest's esbuild transform does not type-check test files against the
// component's actual (not-yet-updated) signature, so this compiles and runs
// today even though the real component doesn't accept most of these props
// yet — which is exactly what lets these tests fail at the assertion level
// (missing "Edit"/"Format" UI) rather than at compile time.
type PlannedProps = {
    onOpenCsvExport: () => void;
    onOpenXlsxExport: () => void;
    onOpenHtmlExport: () => void;
    onOpenPrint: () => void;
    onSave: () => void;
    onToggleHistory: () => void;
    setHamburgerDialog: (dialog: string | null) => void;
    setHamburgerDeleteConfirm: (v: boolean) => void;
    isViewer?: boolean;
    officeMode?: boolean;
    onConvertToNative?: () => void;

    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSelectAll: () => void;
    onOpenFindReplace: () => void;

    cellStyle?: CellStyle;
    onStyleChange: (style: Partial<CellStyle>) => void;
    formatDisabled?: boolean;
    isMerged: boolean;
    onMergeCells: () => void;

    onInsertChart?: () => void;
};

function baseProps(overrides: Partial<PlannedProps> = {}): PlannedProps {
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
        officeMode: false,
        onConvertToNative: vi.fn(),

        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: true,
        canRedo: true,
        onCut: vi.fn(),
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onSelectAll: vi.fn(),
        onOpenFindReplace: vi.fn(),

        cellStyle: undefined,
        onStyleChange: vi.fn(),
        formatDisabled: false,
        isMerged: false,
        onMergeCells: vi.fn(),

        onInsertChart: undefined,
        ...overrides,
    };
}

// All keys of CellStyle — used to assert "Clear formatting" explicitly
// unsets every style property (rather than being a no-op / partial stub).
const CELL_STYLE_KEYS: (keyof CellStyle)[] = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration',
    'color', 'backgroundColor', 'textAlign', 'verticalAlign', 'borderStyle',
    'numberFormat', 'decimalPlaces', 'customFormat', 'wrapMode',
];

function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
}

// Top-level categories ("File"/"Edit"/"Format"/"Insert") and nested
// submenus (e.g. "New", "Borders") all use the same `kind: 'submenu'`
// primitive, whose row has the `onMouseEnter` handler directly on the
// element wrapping the label `<span>`. `getByText` resolves to that
// innermost `<span>`, so `.closest('div')` walks up to the row that owns
// the handler.
function hoverCategory(label: string) {
    const labelEl = screen.getByText(label);
    const row = labelEl.closest('div');
    if (!row) throw new Error(`could not find hoverable row for "${label}"`);
    fireEvent.mouseEnter(row);
}

function openMenuAndHover(label: string) {
    openMenu();
    hoverCategory(label);
}

describe('sheets HamburgerMenu — category reorganisation (planned)', () => {
    describe('top-level categories', () => {
        it('is closed until the hamburger button is clicked', () => {
            render(<HamburgerMenu {...baseProps()} />);
            expect(screen.queryByText('File')).not.toBeInTheDocument();
        });

        it('shows File, Edit, and Format top-level categories once opened', () => {
            render(<HamburgerMenu {...baseProps()} />);
            openMenu();

            expect(screen.getByText('File')).toBeInTheDocument();
            expect(screen.getByText('Edit')).toBeInTheDocument();
            expect(screen.getByText('Format')).toBeInTheDocument();
        });

        it('does not show an Insert category when onInsertChart is not provided', () => {
            render(<HamburgerMenu {...baseProps({ onInsertChart: undefined })} />);
            openMenu();

            expect(screen.queryByText('Insert')).not.toBeInTheDocument();
        });

        it('shows an Insert category when onInsertChart is provided', () => {
            render(<HamburgerMenu {...baseProps({ onInsertChart: vi.fn() })} />);
            openMenu();

            expect(screen.getByText('Insert')).toBeInTheDocument();
        });
    });

    describe('Edit category', () => {
        it.each<[string, keyof PlannedProps]>([
            ['Undo', 'onUndo'],
            ['Redo', 'onRedo'],
            ['Cut', 'onCut'],
            ['Copy', 'onCopy'],
            ['Paste', 'onPaste'],
            ['Select all', 'onSelectAll'],
            ['Find and replace', 'onOpenFindReplace'],
        ])('reveals "%s" under Edit and clicking it calls %s exactly once', (label, propName) => {
            const props = baseProps();
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Edit');

            fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }));

            expect(props[propName]).toHaveBeenCalledTimes(1);
        });

        it('disables Undo when canUndo is false, and clicking it does not call onUndo', () => {
            const props = baseProps({ canUndo: false });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Edit');

            const undoBtn = screen.getByRole('button', { name: /^undo/i });
            expect(undoBtn).toBeDisabled();

            fireEvent.click(undoBtn);
            expect(props.onUndo).not.toHaveBeenCalled();
        });

        it('disables Redo when canRedo is false, and clicking it does not call onRedo', () => {
            const props = baseProps({ canRedo: false });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Edit');

            const redoBtn = screen.getByRole('button', { name: /^redo/i });
            expect(redoBtn).toBeDisabled();

            fireEvent.click(redoBtn);
            expect(props.onRedo).not.toHaveBeenCalled();
        });

        it('enables Undo/Redo when canUndo/canRedo are true', () => {
            render(<HamburgerMenu {...baseProps({ canUndo: true, canRedo: true })} />);
            openMenuAndHover('Edit');

            expect(screen.getByRole('button', { name: /^undo/i })).not.toBeDisabled();
            expect(screen.getByRole('button', { name: /^redo/i })).not.toBeDisabled();
        });
    });

    describe('Format category — Bold toggle', () => {
        it('calls onStyleChange({ fontWeight: "bold" }) when Bold is clicked and the cell is not currently bold', () => {
            const props = baseProps({ cellStyle: {} });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Format');

            fireEvent.click(screen.getByRole('button', { name: /^bold/i }));

            expect(props.onStyleChange).toHaveBeenCalledTimes(1);
            expect(props.onStyleChange).toHaveBeenCalledWith({ fontWeight: 'bold' });
        });

        it('calls onStyleChange({ fontWeight: "normal" }) when Bold is clicked and the cell is already bold', () => {
            const props = baseProps({ cellStyle: { fontWeight: 'bold' } });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Format');

            // Toggle-on state should be reflected in the label per the plan
            // (e.g. "Bold ✓").
            expect(screen.getByText(/^Bold/)).toHaveTextContent('✓');

            fireEvent.click(screen.getByRole('button', { name: /^bold/i }));

            expect(props.onStyleChange).toHaveBeenCalledTimes(1);
            expect(props.onStyleChange).toHaveBeenCalledWith({ fontWeight: 'normal' });
        });
    });

    describe('Format category — Clear formatting', () => {
        it('calls onStyleChange with every CellStyle key explicitly set to undefined (not a no-op)', () => {
            const props = baseProps();
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Format');

            fireEvent.click(screen.getByRole('button', { name: /clear formatting/i }));

            expect(props.onStyleChange).toHaveBeenCalledTimes(1);
            const arg = (props.onStyleChange as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;

            for (const key of CELL_STYLE_KEYS) {
                expect(Object.prototype.hasOwnProperty.call(arg, key)).toBe(true);
                expect(arg[key]).toBeUndefined();
            }
        });
    });

    describe('Format category — Merge/Unmerge cells', () => {
        it('shows "Merge cells" and calls onMergeCells when isMerged is false', () => {
            const props = baseProps({ isMerged: false });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Format');

            expect(screen.queryByText('Unmerge cells')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Merge cells' }));

            expect(props.onMergeCells).toHaveBeenCalledTimes(1);
        });

        it('shows "Unmerge cells" and calls onMergeCells when isMerged is true', () => {
            const props = baseProps({ isMerged: true });
            render(<HamburgerMenu {...props} />);
            openMenuAndHover('Format');

            expect(screen.queryByText('Merge cells')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Unmerge cells' }));

            expect(props.onMergeCells).toHaveBeenCalledTimes(1);
        });
    });

    describe('Insert category', () => {
        it('renders "Insert chart…" and clicking it calls onInsertChart exactly once', () => {
            const onInsertChart = vi.fn();
            render(<HamburgerMenu {...baseProps({ onInsertChart })} />);
            openMenuAndHover('Insert');

            fireEvent.click(screen.getByRole('button', { name: /insert chart/i }));

            expect(onInsertChart).toHaveBeenCalledTimes(1);
        });
    });

    describe('isViewer', () => {
        it('hides Edit, Format, and Insert categories but keeps File', () => {
            render(<HamburgerMenu {...baseProps({ isViewer: true, onInsertChart: vi.fn() })} />);
            openMenu();

            expect(screen.getByText('File')).toBeInTheDocument();
            expect(screen.queryByText('Edit')).not.toBeInTheDocument();
            expect(screen.queryByText('Format')).not.toBeInTheDocument();
            expect(screen.queryByText('Insert')).not.toBeInTheDocument();
        });
    });

    describe('officeMode (regression)', () => {
        it('shows "Convert to Neutrino Sheet" inside File when officeMode is true', () => {
            render(<HamburgerMenu {...baseProps({ officeMode: true, onConvertToNative: vi.fn() })} />);
            openMenuAndHover('File');

            expect(screen.getByText('Convert to Neutrino Sheet')).toBeInTheDocument();
        });
    });

    describe('Help category', () => {
        it('shows Help even when isViewer is true', () => {
            render(<HamburgerMenu {...baseProps({ isViewer: true })} />);
            openMenu();

            expect(screen.getByText('Help')).toBeInTheDocument();
        });

        it('opens a help modal with keyboard shortcuts when "Keyboard shortcuts & help" is clicked, and it can be closed', () => {
            render(<HamburgerMenu {...baseProps()} />);
            openMenuAndHover('Help');

            fireEvent.click(screen.getByRole('button', { name: /keyboard shortcuts & help/i }));

            expect(screen.getByText('Neutrino Sheets — Help')).toBeInTheDocument();
            expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
            expect(screen.getByText('Undo')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /close/i }));
            expect(screen.queryByText('Neutrino Sheets — Help')).not.toBeInTheDocument();
        });
    });
});
