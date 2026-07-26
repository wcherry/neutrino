/**
 * Unit tests for Cell.tsx's border rendering (TDD red phase — the per-side
 * border feature does not exist yet).
 *
 * Today Cell.tsx (lines ~17-21) only understands a single uniform
 * `cellStyle.borderStyle` enum, rendered via the CSS `border` shorthand:
 *   cs?.borderStyle === 'thin'   -> { border: '1px solid #999' }
 *   cs?.borderStyle === 'medium' -> { border: '2px solid #555' }
 *   cs?.borderStyle === 'thick'  -> { border: '3px solid #111' }
 *   otherwise                    -> {}
 *
 * The planned feature adds 4 new optional `CellStyle` fields — `borderTop`,
 * `borderRight`, `borderBottom`, `borderLeft` (same 'none'|'thin'|'medium'|
 * 'thick' enum) — and changes Cell.tsx's rule to:
 *   - If ANY of the 4 side fields is not `undefined`, render each side
 *     independently via the `borderTop`/`borderRight`/`borderBottom`/
 *     `borderLeft` CSS longhand properties (mapping 'thin'->'1px solid #999',
 *     'medium'->'2px solid #555', 'thick'->'3px solid #111', 'none' or
 *     `undefined` -> 'none'). A side that is itself `undefined` while a
 *     sibling side is defined must NOT fall back to the legacy uniform
 *     `borderStyle` — it renders with no border at all.
 *   - If NONE of the 4 side fields is defined, fall back exactly to the
 *     legacy uniform `border` shorthand behavior above.
 *
 * jsdom quirk this file relies on (verified empirically against the
 * `jsdom`/`cssstyle` version pinned in this repo): setting the CSS `border`
 * shorthand property populates `style.borderTop` (jsdom expands the
 * shorthand into its longhand sub-properties for reads), but the reverse is
 * NOT true — setting the 4 longhand properties individually (even to
 * identical values on all 4 sides) leaves the top-level `style.border`
 * getter as `''`, because jsdom's cssstyle implementation does not recompose
 * a shorthand from consistent longhands. This gives a robust, mechanism-level
 * signal for "legacy shorthand path was used" (`style.border` non-empty) vs
 * "new per-side path was used" (`style.border === ''`), independent of the
 * visual result. Separately, `style.border{Top,Right,Bottom,Left}Style`/
 * `Width` longhand getters reliably read back `'solid'`/`'1px'` etc. when a
 * side has an actual border, and read back `''` (indistinguishable from
 * "not set") when the side is `'none'` or unset — which is fine, since both
 * of those must render with *no visible border*, so the test only needs to
 * assert "not solid", not distinguish `'none'` from absent at the DOM level.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Cell } from '../../app/(apps)/sheets/editor/Cell';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

function renderCell(cellStyle?: CellStyle): HTMLElement {
    const { container } = render(
        <Cell id="A1" edit={false} value="Aa" cellStyle={cellStyle} />
    );
    const el = container.querySelector('#A1') as HTMLElement;
    if (!el) throw new Error('expected Cell to render a div#A1');
    return el;
}

describe('Cell.tsx border rendering', () => {
    it('renders no border at all when cellStyle is undefined', () => {
        const el = renderCell(undefined);
        expect(el.style.border).toBe('');
        expect(el.style.borderTopStyle).toBe('');
    });

    describe('legacy fallback — none of the 4 side fields defined', () => {
        it('renders the uniform CSS border shorthand for borderStyle "thin"', () => {
            const el = renderCell({ borderStyle: 'thin' });
            expect(el.style.border).toBe('1px solid rgb(153, 153, 153)');
        });

        it('renders the uniform CSS border shorthand for borderStyle "medium"', () => {
            const el = renderCell({ borderStyle: 'medium' });
            expect(el.style.border).toBe('2px solid rgb(85, 85, 85)');
        });

        it('renders the uniform CSS border shorthand for borderStyle "thick"', () => {
            const el = renderCell({ borderStyle: 'thick' });
            expect(el.style.border).toBe('3px solid rgb(17, 17, 17)');
        });

        it('renders no border for borderStyle "none"', () => {
            const el = renderCell({ borderStyle: 'none' });
            expect(el.style.border).toBe('');
            expect(el.style.borderTopStyle).toBe('');
        });
    });

    describe('per-side rendering — at least one of the 4 side fields is defined', () => {
        it('horizontal-only: renders top/bottom borders and explicit "none" left/right as no border, via longhand properties (not the shorthand)', () => {
            const el = renderCell({
                borderTop: 'thin',
                borderBottom: 'thin',
                borderLeft: 'none',
                borderRight: 'none',
            });

            // Proves the per-side (longhand) code path was taken, not the
            // legacy `border` shorthand.
            expect(el.style.border).toBe('');

            expect(el.style.borderTopStyle).toBe('solid');
            expect(el.style.borderTopWidth).toBe('1px');
            expect(el.style.borderBottomStyle).toBe('solid');
            expect(el.style.borderBottomWidth).toBe('1px');

            expect(el.style.borderLeftStyle).toBe('');
            expect(el.style.borderRightStyle).toBe('');
        });

        it('a side left as literal `undefined` while siblings are defined still renders as no-border on that side, not the legacy uniform border', () => {
            const el = renderCell({
                // borderStyle deliberately set to something highly visible —
                // it must NOT leak onto the undefined side fields below.
                borderStyle: 'thick',
                borderTop: 'thin',
                borderRight: undefined,
                borderBottom: undefined,
                borderLeft: undefined,
            });

            // Any side field being non-undefined must switch Cell.tsx into
            // the per-side path — the legacy `border` shorthand must not be
            // used at all here.
            expect(el.style.border).toBe('');

            expect(el.style.borderTopStyle).toBe('solid');
            expect(el.style.borderTopWidth).toBe('1px');

            // Undefined siblings must render as no border — specifically NOT
            // the thick (3px) border that `borderStyle` alone would produce.
            expect(el.style.borderRightStyle).toBe('');
            expect(el.style.borderBottomStyle).toBe('');
            expect(el.style.borderLeftStyle).toBe('');
        });

        it('all four sides explicitly "none" render no border anywhere, even when borderStyle is separately "thin" (side fields win)', () => {
            const el = renderCell({
                borderStyle: 'thin',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                borderLeft: 'none',
            });

            expect(el.style.border).toBe('');
            expect(el.style.borderTopStyle).toBe('');
            expect(el.style.borderRightStyle).toBe('');
            expect(el.style.borderBottomStyle).toBe('');
            expect(el.style.borderLeftStyle).toBe('');
        });

        it('renders medium/thick widths correctly per side', () => {
            const el = renderCell({
                borderTop: 'medium',
                borderRight: 'thick',
                borderBottom: 'none',
                borderLeft: 'none',
            });

            expect(el.style.borderTopStyle).toBe('solid');
            expect(el.style.borderTopWidth).toBe('2px');
            expect(el.style.borderRightStyle).toBe('solid');
            expect(el.style.borderRightWidth).toBe('3px');
        });
    });
});
