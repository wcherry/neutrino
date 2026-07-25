/**
 * Unit tests for TABLE_STYLES (TDD red phase — module does not exist yet).
 *
 * `editor/styles/tableStyles.ts` exports a `TableStyle` interface and a
 * concrete `TABLE_STYLES` array: 14 color families x 2 layout variants (a
 * "banded" variant and a "header & totals" variant) = 28 entries.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * ("Continuation: Table styles gallery (28 presets)") for the full spec this
 * test file is written against.
 */

import { describe, it, expect } from 'vitest';
import { TABLE_STYLES } from '../../app/(apps)/sheets/editor/styles/tableStyles';

// 14-hue palette: hue name -> header background hex -> tint hex (bandColorB).
// bandColorA is always '#ffffff'; borderStyle is always 'thin'.
const PALETTE: { hue: string; headerBg: string; tint: string }[] = [
    { hue: 'Blue', headerBg: '#1e40af', tint: '#dbeafe' },
    { hue: 'Sky', headerBg: '#0369a1', tint: '#e0f2fe' },
    { hue: 'Cyan', headerBg: '#0e7490', tint: '#cffafe' },
    { hue: 'Teal', headerBg: '#0f766e', tint: '#ccfbf1' },
    { hue: 'Emerald', headerBg: '#047857', tint: '#d1fae5' },
    { hue: 'Green', headerBg: '#15803d', tint: '#dcfce7' },
    { hue: 'Lime', headerBg: '#4d7c0f', tint: '#ecfccb' },
    { hue: 'Amber', headerBg: '#b45309', tint: '#fef3c7' },
    { hue: 'Orange', headerBg: '#c2410c', tint: '#ffedd5' },
    { hue: 'Red', headerBg: '#b91c1c', tint: '#fee2e2' },
    { hue: 'Rose', headerBg: '#be123c', tint: '#ffe4e6' },
    { hue: 'Purple', headerBg: '#6d28d9', tint: '#ede9fe' },
    { hue: 'Indigo', headerBg: '#4338ca', tint: '#e0e7ff' },
    { hue: 'Slate', headerBg: '#334155', tint: '#f1f5f9' },
];

describe('TABLE_STYLES', () => {
    it('has exactly 28 entries', () => {
        expect(TABLE_STYLES).toHaveLength(28);
    });

    it('has a unique id for every entry', () => {
        const ids = TABLE_STYLES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('has a unique name for every entry', () => {
        const names = TABLE_STYLES.map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives every entry borderStyle "thin" and bandColorA "#ffffff"', () => {
        for (const style of TABLE_STYLES) {
            expect(style.borderStyle).toBe('thin');
            expect(style.bandColorA).toBe('#ffffff');
        }
    });

    it('gives every entry a white header text color', () => {
        for (const style of TABLE_STYLES) {
            expect(style.header.color).toBe('#ffffff');
        }
    });

    for (const { hue, headerBg, tint } of PALETTE) {
        describe(`${hue} hue family`, () => {
            function entriesForHue() {
                return TABLE_STYLES.filter((s) => s.name.includes(hue));
            }

            it('has exactly 2 entries', () => {
                expect(entriesForHue()).toHaveLength(2);
            });

            it('has one banded variant (headerRow only) and one header+totals variant (all three)', () => {
                const entries = entriesForHue();
                const banded = entries.filter(
                    (s) => s.headerRow === true && s.headerColumn === false && s.totalRow === false
                );
                const headerTotals = entries.filter(
                    (s) => s.headerRow === true && s.headerColumn === true && s.totalRow === true
                );
                expect(banded).toHaveLength(1);
                expect(headerTotals).toHaveLength(1);
            });

            it('uses the correct header backgroundColor and bandColorB for both variants', () => {
                for (const style of entriesForHue()) {
                    expect(style.header.backgroundColor).toBe(headerBg);
                    expect(style.bandColorB).toBe(tint);
                    expect(style.header.color).toBe('#ffffff');
                    expect(style.borderStyle).toBe('thin');
                }
            });
        });
    }
});
