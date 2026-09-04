/**
 * Component tests for the Sheets StyleToolbar (TDD red phase).
 *
 * No StyleToolbar.test.tsx existed before this file (verified via `ls` of
 * `src/__tests__/sheets/` — only FontPicker.test.tsx exercises StyleToolbar,
 * and only for the font-family picker). `@neutrino/ui` is mocked the same
 * way FontPicker.test.tsx mocks it (Toolbar/ToolbarGroup/ToolbarDivider/
 * ToolbarButton/ToolbarSelect/ColorPickerPopover as thin passthroughs) PLUS
 * Modal/ModalHeader/ModalBody the same way TableStyleGalleryModal.test.tsx
 * mocks them, since StyleToolbar mounts `TableStyleGalleryModal` internally
 * once "Table styles" is clicked. `useAvailableFonts` is mocked so the font
 * picker doesn't need a real fonts backend.
 *
 * Two planned changes under test here:
 *
 * 1. Border `<select>` regression fix (~StyleToolbar.tsx line 264-275):
 *    today `onChange` calls `onStyleChange({ borderStyle: e.target.value })`
 *    only. Once per-side borders exist, this must ALSO reset all 4 side
 *    fields to `undefined` in the same call — otherwise a cell with a stale
 *    `borderTop`/etc. from the new per-side feature would silently keep
 *    overriding a uniform border chosen via this select (Cell.tsx's planned
 *    rule: any defined side field wins over `borderStyle` entirely).
 *
 * 2. Table styles gallery "Blank" branch (~StyleToolbar.tsx line 420-430):
 *    `StyleToolbar` gains 2 new optional props, `onApplyStyle?: (style:
 *    Partial<CellStyle>) => void` and `onClearTableRegions?: (cells:
 *    Set<string>) => void`. The gallery's `onSelect` handler must branch on
 *    `style.kind`: `'blank'` calls `onApplyStyle(style.clearPatch)` +
 *    `onClearTableRegions(selectedCells)` and must NOT call
 *    `onApplyStyleMap`/`onRegisterTableRegion`; any other style still goes
 *    through the existing `onApplyStyleMap`/`onRegisterTableRegion` path and
 *    must NOT call `onApplyStyle`/`onClearTableRegions`.
 *
 * `TABLE_STYLES` will only contain a `'blank'`-kind entry once
 * `tableStyles.ts` is updated (see tableStyles.test.ts) — until then, the
 * "select Blank" test below correctly fails at the `cardButtonFor('Blank')`
 * lookup (no such card exists yet), which is the expected red-phase failure
 * reason.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@neutrino/ui', () => ({
    Toolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ToolbarGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ToolbarDivider: () => <hr />,
    ToolbarButton: ({ children, onClick, title, disabled }: { children?: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean }) => (
        <button onClick={onClick} title={title} disabled={disabled}>{children}</button>
    ),
    FontSizeInput: ({ value, onChange, title = 'Font size', disabled }: {
      value?: string | number;
      onChange?: (size: number) => void;
      title?: string;
      disabled?: boolean;
    }) => (
      <input title={title} value={value} disabled={disabled} onChange={e => onChange?.(Number(e.target.value))} />
    ),
    ToolbarSelect: ({
        children,
        value,
        onChange,
        title,
        disabled,
    }: {
        children?: React.ReactNode;
        value?: string | number;
        onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
        title?: string;
        disabled?: boolean;
    }) => (
        <select title={title} value={value} onChange={onChange} disabled={disabled}>
            {children}
        </select>
    ),
    ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
        open ? <div data-testid="modal">{children}</div> : null,
    ModalHeader: ({ title, onClose }: { title?: string; onClose?: () => void }) => (
        <div>
            <span>{title}</span>
            {onClose && <button onClick={onClose}>close</button>}
        </div>
    ),
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useAvailableFonts', () => ({
    useAvailableFonts: () => ({
        fontFamilies: [{ label: 'Arial', value: 'Arial, sans-serif' }],
        fontFamilyNames: [],
        customFontFamilies: [],
        customFontFamilyNames: [],
        loaded: true,
    }),
}));

import { StyleToolbar } from '../../app/(apps)/sheets/editor/StyleToolbar';
import { TABLE_STYLES } from '../../app/(apps)/sheets/editor/styles/tableStyles';

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardButtonFor(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(escapeRegExp(name)) });
}

function baseProps(overrides: Record<string, unknown> = {}) {
    return {
        cellStyle: undefined,
        onStyleChange: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
        onMergeCells: vi.fn(),
        isMerged: false,
        selectedCells: new Set<string>(['A1', 'B1']),
        onApplyStyleMap: vi.fn(),
        onRegisterTableRegion: vi.fn(),
        onApplyStyle: vi.fn(),
        onClearTableRegions: vi.fn(),
        ...overrides,
    };
}

describe('Sheets StyleToolbar — border select regression fix', () => {
    it.each<[string, string | undefined]>([
        ['none', 'none'],
        ['thin', 'thin'],
        ['medium', 'medium'],
        ['thick', 'thick'],
    ])('changing the Border Style select to "%s" also resets all 4 side fields to undefined', (optionValue) => {
        const props = baseProps();
        render(<StyleToolbar {...(props as any)} />);

        const select = screen.getByTitle('Border Style') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: optionValue } });

        expect(props.onStyleChange).toHaveBeenCalledWith(
            expect.objectContaining({
                borderStyle: optionValue,
                borderTop: undefined,
                borderRight: undefined,
                borderBottom: undefined,
                borderLeft: undefined,
            })
        );
    });
});

describe('Sheets StyleToolbar — Table styles gallery Blank vs regular branching', () => {
    it('selecting a regular (non-blank) style calls onApplyStyleMap and onRegisterTableRegion, and does not call onApplyStyle/onClearTableRegions', () => {
        const props = baseProps();
        render(<StyleToolbar {...(props as any)} />);

        fireEvent.click(screen.getByTitle('Table styles'));
        const target = TABLE_STYLES[0];
        fireEvent.click(cardButtonFor(target.name));

        expect(props.onApplyStyleMap).toHaveBeenCalledTimes(1);
        expect(props.onRegisterTableRegion).toHaveBeenCalledTimes(1);
        expect(props.onRegisterTableRegion).toHaveBeenCalledWith(target, props.selectedCells);
        expect(props.onApplyStyle).not.toHaveBeenCalled();
        expect(props.onClearTableRegions).not.toHaveBeenCalled();
    });

    it('selecting the Blank style calls onApplyStyle with its clearPatch and onClearTableRegions with selectedCells, and does not call onApplyStyleMap/onRegisterTableRegion', () => {
        const props = baseProps();
        render(<StyleToolbar {...(props as any)} />);

        fireEvent.click(screen.getByTitle('Table styles'));
        // Fails here in red phase: no TABLE_STYLES entry is named "Blank" yet.
        fireEvent.click(cardButtonFor('Blank'));

        const blank = TABLE_STYLES.find((s: any) => s.name === 'Blank') as any;
        expect(props.onApplyStyle).toHaveBeenCalledTimes(1);
        expect(props.onApplyStyle).toHaveBeenCalledWith(blank?.clearPatch);
        expect(props.onClearTableRegions).toHaveBeenCalledTimes(1);
        expect(props.onClearTableRegions).toHaveBeenCalledWith(props.selectedCells);

        expect(props.onApplyStyleMap).not.toHaveBeenCalled();
        expect(props.onRegisterTableRegion).not.toHaveBeenCalled();
    });
});
