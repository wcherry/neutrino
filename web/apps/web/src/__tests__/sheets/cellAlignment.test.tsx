/**
 * Tests for horizontal and vertical text alignment in the Cell component,
 * including merged cells.
 *
 * The content span uses display:flex, so:
 *   - Horizontal: justifyContent (textAlign on the outer div has no effect)
 *   - Vertical: alignItems + height:100% so the span fills the cell height
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Cell } from '../../app/(apps)/sheets/editor/Cell';

// CSS Modules return empty objects in jsdom
vi.mock('../../app/(apps)/sheets/editor/page.module.css', () => ({ default: {} }));

function getContentSpan(container: HTMLElement): HTMLElement {
    // The content span is the last span child of the cell div (after any bar divs)
    const spans = container.querySelector('div')!.querySelectorAll(':scope > span');
    return spans[spans.length - 1] as HTMLElement;
}

describe('Cell — text alignment', () => {
    it('defaults to no justifyContent when textAlign is unset', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('');
    });

    it('applies justifyContent center when textAlign is center', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ textAlign: 'center' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('center');
    });

    it('applies justifyContent flex-end when textAlign is right', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ textAlign: 'right' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('flex-end');
    });

    it('applies no justifyContent when textAlign is left (default flow)', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ textAlign: 'left' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('');
    });
});

describe('Cell — alignment on merged cells', () => {
    const mergedStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 300,   // spans 3 columns
        height: 28,
        minWidth: 'unset',
        maxWidth: 'unset',
        zIndex: 1,
    };

    it('centers content in a horizontally merged cell', () => {
        const { container } = render(
            <Cell id="A1" value="Merged" raw="Merged" edit={false}
                colSpan={3}
                cellStyle={{ textAlign: 'center' }}
                style={mergedStyle} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('center');
    });

    it('right-aligns content in a horizontally merged cell', () => {
        const { container } = render(
            <Cell id="A1" value="Merged" raw="Merged" edit={false}
                colSpan={3}
                cellStyle={{ textAlign: 'right' }}
                style={mergedStyle} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('flex-end');
    });

    it('centers content in a block-merged cell (colSpan + rowSpan)', () => {
        const blockMergedStyle: React.CSSProperties = {
            ...mergedStyle,
            width: 300,
            height: 84,  // spans 3 rows
        };
        const { container } = render(
            <Cell id="B2" value="Block" raw="Block" edit={false}
                colSpan={3} rowSpan={3}
                cellStyle={{ textAlign: 'center' }}
                style={blockMergedStyle} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('center');
    });

    it('preserves other styles alongside alignment on merged cells', () => {
        const { container } = render(
            <Cell id="A1" value="Bold" raw="Bold" edit={false}
                colSpan={2}
                cellStyle={{ textAlign: 'center', fontWeight: 'bold', backgroundColor: '#ff0' }}
                style={mergedStyle} />
        );
        const div = container.querySelector('div')!;
        const span = getContentSpan(container);
        expect(div.style.fontWeight).toBe('bold');
        expect(div.style.backgroundColor).toBe('rgb(255, 255, 0)');
        expect(span.style.justifyContent).toBe('center');
    });
});

// ── Vertical alignment ────────────────────────────────────────────────────────

describe('Cell — vertical alignment', () => {
    it('defaults to alignItems center when verticalAlign is unset', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false} />
        );
        const span = getContentSpan(container);
        expect(span.style.alignItems).toBe('center');
    });

    it('applies alignItems center for verticalAlign middle', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ verticalAlign: 'middle' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.alignItems).toBe('center');
    });

    it('applies alignItems flex-start for verticalAlign top', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ verticalAlign: 'top' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.alignItems).toBe('flex-start');
    });

    it('applies alignItems flex-end for verticalAlign bottom', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ verticalAlign: 'bottom' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.alignItems).toBe('flex-end');
    });

    it('span has height 100% so vertical alignment has effect', () => {
        const { container } = render(
            <Cell id="A1" value="Hello" raw="Hello" edit={false}
                cellStyle={{ verticalAlign: 'bottom' }} />
        );
        const span = getContentSpan(container);
        expect(span.style.height).toBe('100%');
    });
});

describe('Cell — vertical alignment on merged cells', () => {
    const mergedStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 200,
        height: 84,   // spans 3 rows
        minWidth: 'unset',
        maxWidth: 'unset',
        zIndex: 1,
    };

    it('top-aligns content in a tall merged cell', () => {
        const { container } = render(
            <Cell id="A1" value="Tall" raw="Tall" edit={false}
                rowSpan={3}
                cellStyle={{ verticalAlign: 'top' }}
                style={mergedStyle} />
        );
        expect(getContentSpan(container).style.alignItems).toBe('flex-start');
    });

    it('bottom-aligns content in a tall merged cell', () => {
        const { container } = render(
            <Cell id="A1" value="Tall" raw="Tall" edit={false}
                rowSpan={3}
                cellStyle={{ verticalAlign: 'bottom' }}
                style={mergedStyle} />
        );
        expect(getContentSpan(container).style.alignItems).toBe('flex-end');
    });

    it('combines horizontal and vertical alignment independently', () => {
        const { container } = render(
            <Cell id="A1" value="X" raw="X" edit={false}
                colSpan={2} rowSpan={2}
                cellStyle={{ textAlign: 'right', verticalAlign: 'top' }}
                style={mergedStyle} />
        );
        const span = getContentSpan(container);
        expect(span.style.justifyContent).toBe('flex-end');
        expect(span.style.alignItems).toBe('flex-start');
    });
});
