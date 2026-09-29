/**
 * Issue #212 — sheet tabs were unreadable under a dark theme.
 *
 * Two independent causes, one per half of this file. The bar's own colours
 * named `data-theme="dark"` and so missed Midnight, Glass, Forest and every
 * custom theme, which is a CSS fix with nothing to assert here. What *is*
 * assertable is the other half: a tab carrying a colour picks its foreground
 * from that colour, and the rename input inherits it rather than re-deriving
 * one from the theme.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetTabBar, readableTextOn } from '@/app/(apps)/sheets/editor/components/SheetTabBar';

const TAB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

/** WCAG 2.x contrast ratio, computed independently of the implementation. */
function contrast(a: string, b: string): number {
    const lum = (hex: string) => {
        const ch = (i: number) => {
            const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

function renderBar(props: Partial<React.ComponentProps<typeof SheetTabBar>> = {}) {
    const dirtyRef = { current: false };
    return render(
        <SheetTabBar
            sheetNames={['Sheet1', 'Sheet2']}
            sheetColors={[null, null]}
            setSheetColors={vi.fn()}
            activeSheetIndex={0}
            dirtyRef={dirtyRef}
            onSwitchSheet={vi.fn()}
            onAddSheet={vi.fn()}
            onDeleteSheet={vi.fn()}
            onDuplicateSheet={vi.fn()}
            onMoveSheet={vi.fn()}
            onCommitRename={vi.fn()}
            {...props}
        />,
    );
}

describe('readableTextOn', () => {
    it('beats 4.5:1 on every colour the tab menu offers', () => {
        for (const color of TAB_COLORS) {
            const fg = readableTextOn(color)!;
            expect(contrast(fg, color), `${fg} on ${color}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('is the reason a dark theme cannot supply this foreground', () => {
        // Every preset is light enough to take black, and white fails all seven
        // — 1.9:1 on the yellow. So under a dark theme, where `--color-text` is
        // #f1f5f9, a coloured tab was unreadable whatever colour was picked.
        for (const color of TAB_COLORS) {
            expect(readableTextOn(color), color).toBe('#000000');
            expect(contrast('#f1f5f9', color), `theme text on ${color}`).toBeLessThan(4.5);
        }
    });

    it('switches to white for a background dark enough to need it', () => {
        // Not reachable from the menu, but a tabColor out of an imported .xlsx
        // is any colour at all.
        expect(readableTextOn('#4c1d95')).toBe('#ffffff');
        expect(readableTextOn('#000000')).toBe('#ffffff');
        expect(readableTextOn('#ffffff')).toBe('#000000');
    });

    it('reads three-digit hex the same as six', () => {
        expect(readableTextOn('#fff')).toBe(readableTextOn('#ffffff'));
        expect(readableTextOn('#000')).toBe(readableTextOn('#000000'));
    });

    it('defers to the theme for no colour, or one it cannot read', () => {
        // undefined leaves the CSS `color` in place rather than overriding it
        // with a guess — an uncoloured tab must follow the theme.
        expect(readableTextOn(null)).toBeUndefined();
        expect(readableTextOn('')).toBeUndefined();
        expect(readableTextOn('red')).toBeUndefined();
        expect(readableTextOn('rgb(1,2,3)')).toBeUndefined();
    });
});

describe('SheetTabBar colours', () => {
    it('sets a foreground alongside a tab colour, and neither without one', () => {
        renderBar({ sheetColors: ['#eab308', null] });

        const colored = screen.getByText('Sheet1');
        expect(colored.style.backgroundColor).toBe('rgb(234, 179, 8)');
        expect(colored.style.color).toBe('rgb(0, 0, 0)');

        const plain = screen.getByText('Sheet2');
        expect(plain.style.backgroundColor).toBe('');
        expect(plain.style.color).toBe('');
    });

    it('leaves the rename input inheriting the tab it sits in', () => {
        renderBar({ sheetColors: ['#4c1d95', null] });

        fireEvent.doubleClick(screen.getByText('Sheet1'));
        const input = screen.getByTestId('sheet-tab-rename-input');

        // The input must carry no colour of its own: the tab sets the readable
        // one and `.sheetTabInput { color: inherit }` carries it down. An
        // inline colour here would be the theme's, which is the bug.
        expect(input.getAttribute('style')).toBeNull();
        expect(input.closest('div')!.style.color).toBe('rgb(255, 255, 255)');
    });

    it('marks the current colour with a class rather than a hardcoded ring', () => {
        renderBar({ sheetColors: ['#22c55e', null] });

        fireEvent.contextMenu(screen.getByText('Sheet1'));
        const swatches = screen.getAllByTitle(/^#|^No color$/);
        const selected = swatches.filter(s => s.className.includes('ColorSwatchSelected'));

        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute('title')).toBe('#22c55e');
        // A literal `outline: 2px solid #000` is invisible on a dark menu.
        expect(selected[0].style.outline).toBe('');
    });
});
