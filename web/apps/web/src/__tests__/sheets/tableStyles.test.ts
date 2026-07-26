/**
 * Unit tests for TABLE_STYLES (TDD red phase — the 85-entry shape below does
 * not exist yet; today's implementation still has the OLD 28-entry,
 * single-`borderStyle` shape this file previously tested).
 *
 * `editor/styles/tableStyles.ts` is being extended to cross the existing
 * 14-hue x 2-layout ("Banded" / "Header & Totals") matrix with 3 border
 * variants — uniform (unchanged), no borders, and horizontal-only borders —
 * for 14 x 2 x 3 = 84 `RegularTableStyle` entries, PLUS exactly 1 hand-written
 * `BlankTableStyle` ("Blank", which clears all cell formatting) = 85 total.
 *
 * Backward compatibility requirement (persisted data): the uniform-border
 * variant of every hue/layout combo MUST keep its exact current id (e.g.
 * `blue-banded`, `slate-header-totals`) and name (e.g. "Blue Banded"), since
 * `TableRegion.styleId` values are persisted in saved sheets today. New
 * border variants get suffixed ids/names (see BORDER_VARIANTS below).
 */

import { describe, it, expect } from 'vitest';
import { TABLE_STYLES } from '../../app/(apps)/sheets/editor/styles/tableStyles';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

// 14-hue palette: hue name -> header background hex -> tint hex (bandColorB).
// bandColorA is always '#ffffff'; header text is always white.
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

const LAYOUTS: { slug: string; label: string; headerRow: boolean; headerColumn: boolean; totalRow: boolean }[] = [
    { slug: 'banded', label: 'Banded', headerRow: true, headerColumn: false, totalRow: false },
    { slug: 'header-totals', label: 'Header & Totals', headerRow: true, headerColumn: true, totalRow: true },
];

// The 3 border-patch shapes every RegularTableStyle.border must match one of.
// Exact shapes pinned by the plan — export names in the real implementation
// are unconstrained, only these resulting shapes matter.
const UNIFORM_BORDER: Partial<CellStyle> = {
    borderStyle: 'thin', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined,
};
const NO_BORDER: Partial<CellStyle> = {
    borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
};
const HORIZONTAL_BORDER: Partial<CellStyle> = {
    borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none',
};

const BORDER_VARIANTS: { idSuffix: string; nameSuffix: string; patch: Partial<CellStyle> }[] = [
    { idSuffix: '', nameSuffix: '', patch: UNIFORM_BORDER },
    { idSuffix: '-no-border', nameSuffix: ' — No Border', patch: NO_BORDER },
    { idSuffix: '-horizontal', nameSuffix: ' — Horizontal Lines', patch: HORIZONTAL_BORDER },
];

// The "Clear formatting" 14 keys from HamburgerMenu.tsx's Format menu
// (~line 232-248), UNION the 4 new border side keys. Hardcoded here per the
// plan's instruction (rather than importing/introspecting the component) —
// MUST be kept in sync with HamburgerMenu.tsx's "Clear formatting" action if
// that list ever changes.
const CLEAR_PATCH_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration',
    'color', 'backgroundColor', 'textAlign', 'verticalAlign', 'borderStyle',
    'numberFormat', 'decimalPlaces', 'customFormat', 'wrapMode',
    'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
] as const;

function regularEntries() {
    return TABLE_STYLES.filter((s: any) => s.kind === 'regular');
}

describe('TABLE_STYLES', () => {
    it('has exactly 85 entries', () => {
        expect(TABLE_STYLES).toHaveLength(85);
    });

    it('has exactly 1 entry with kind "blank" and 84 entries with kind "regular"', () => {
        const blanks = TABLE_STYLES.filter((s: any) => s.kind === 'blank');
        const regulars = regularEntries();
        expect(blanks).toHaveLength(1);
        expect(regulars).toHaveLength(84);
    });

    it('has a unique id for every entry', () => {
        const ids = TABLE_STYLES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('has a unique name for every entry', () => {
        const names = TABLE_STYLES.map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    describe('regression — the original 28 uniform-border ids/names are preserved unchanged', () => {
        for (const { hue } of PALETTE) {
            for (const layout of LAYOUTS) {
                const id = `${hue.toLowerCase()}-${layout.slug}`;
                const name = `${hue} ${layout.label}`;

                it(`"${id}" still exists with name "${name}" and an unchanged (uniform) border patch`, () => {
                    const entry = TABLE_STYLES.find((s) => s.id === id);
                    expect(entry).toBeDefined();
                    expect(entry?.name).toBe(name);
                    // toEqual (not toStrictEqual): vitest's toEqual already
                    // treats an explicit-undefined key the same as a missing
                    // key, so this proves "no visual change" for callers
                    // that never touched the 4 new side fields, without
                    // requiring an exact key-count match against old fixtures.
                    expect((entry as any)?.border).toEqual(UNIFORM_BORDER);
                });
            }
        }
    });

    describe('full 14 x 2 x 3 regular-style matrix', () => {
        for (const { hue, headerBg, tint } of PALETTE) {
            describe(`${hue} hue family`, () => {
                it('has exactly 3 Banded entries and exactly 3 Header & Totals entries', () => {
                    const banded = regularEntries().filter(
                        (s: any) => s.id.startsWith(`${hue.toLowerCase()}-banded`) && s.headerRow === true && s.headerColumn === false && s.totalRow === false
                    );
                    const headerTotals = regularEntries().filter(
                        (s: any) => s.id.startsWith(`${hue.toLowerCase()}-header-totals`) && s.headerRow === true && s.headerColumn === true && s.totalRow === true
                    );
                    expect(banded).toHaveLength(3);
                    expect(headerTotals).toHaveLength(3);
                });

                for (const layout of LAYOUTS) {
                    for (const variant of BORDER_VARIANTS) {
                        const id = `${hue.toLowerCase()}-${layout.slug}${variant.idSuffix}`;
                        const name = `${hue} ${layout.label}${variant.nameSuffix}`;

                        it(`"${id}" exists with name "${name}", correct border patch, and correct header/bandColorB`, () => {
                            const entry = TABLE_STYLES.find((s) => s.id === id) as any;
                            expect(entry).toBeDefined();
                            expect(entry.kind).toBe('regular');
                            expect(entry.name).toBe(name);
                            expect(entry.border).toEqual(variant.patch);
                            expect(entry.header).toEqual({ backgroundColor: headerBg, color: '#ffffff' });
                            expect(entry.bandColorA).toBe('#ffffff');
                            expect(entry.bandColorB).toBe(tint);
                            expect(entry.headerRow).toBe(layout.headerRow);
                            expect(entry.headerColumn).toBe(layout.headerColumn);
                            expect(entry.totalRow).toBe(layout.totalRow);
                        });
                    }
                }
            });
        }
    });

    describe('the "Blank" entry', () => {
        function blankEntry(): any {
            return TABLE_STYLES.find((s: any) => s.kind === 'blank');
        }

        it('exists exactly once with id "blank", name "Blank", and kind "blank"', () => {
            const entry = blankEntry();
            expect(entry).toBeDefined();
            expect(entry.id).toBe('blank');
            expect(entry.name).toBe('Blank');
            expect(entry.kind).toBe('blank');
        });

        it('has a clearPatch whose key set is exactly the 14 HamburgerMenu "Clear formatting" keys plus the 4 new border side keys', () => {
            const entry = blankEntry();
            const clearPatch = entry.clearPatch as Record<string, unknown>;
            const actualKeys = Object.keys(clearPatch).sort();
            expect(actualKeys).toEqual([...CLEAR_PATCH_KEYS].sort());
        });

        it('sets every key in clearPatch to undefined', () => {
            const entry = blankEntry();
            const clearPatch = entry.clearPatch as Record<string, unknown>;
            for (const key of CLEAR_PATCH_KEYS) {
                expect(clearPatch[key]).toBeUndefined();
            }
        });
    });
});
