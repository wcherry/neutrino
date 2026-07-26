import type { CellStyle } from '../types';

export type BorderPatch = Pick<CellStyle, 'borderStyle' | 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft'>;

export type RegularTableStyle = {
    kind: 'regular';
    id: string;
    name: string;
    header: { backgroundColor: string; color: string };
    bandColorA: string;
    bandColorB: string;
    border: BorderPatch;
    headerRow: boolean;
    headerColumn: boolean;
    totalRow: boolean;
};

export type BlankTableStyle = {
    kind: 'blank';
    id: 'blank';
    name: 'Blank';
    clearPatch: Partial<CellStyle>;
};

export type TableStyle = RegularTableStyle | BlankTableStyle;

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

type VariantDescriptor = {
    slug: string;
    label: string;
    headerRow: boolean;
    headerColumn: boolean;
    totalRow: boolean;
};

const VARIANTS: VariantDescriptor[] = [
    { slug: 'banded', label: 'Banded', headerRow: true, headerColumn: false, totalRow: false },
    { slug: 'header-totals', label: 'Header & Totals', headerRow: true, headerColumn: true, totalRow: true },
];

// The 3 border-patch shapes crossed with every hue/layout combo. The uniform
// variant keeps the original behavior (a single `borderStyle`, no per-side
// fields) so that the resulting `TableStyle.id`/`name` for that variant are
// unchanged from before per-side borders existed (see BORDER_VARIANTS below).
const UNIFORM_BORDER: BorderPatch = {
    borderStyle: 'thin', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined,
};
const NO_BORDER: BorderPatch = {
    borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
};
const HORIZONTAL_BORDER: BorderPatch = {
    borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none',
};

type BorderVariantDescriptor = {
    idSuffix: string;
    nameSuffix: string;
    patch: BorderPatch;
};

// Backward compatibility: the uniform variant MUST keep idSuffix/nameSuffix
// empty so ids like `blue-banded` and names like "Blue Banded" are unchanged
// — these ids are persisted in saved sheets' `TableRegion.styleId`.
//
// Deliberately ordered with the suffixed variants BEFORE the uniform one:
// the uniform variant's name (e.g. "Blue Banded") is always a literal prefix
// of its own suffixed siblings' names (e.g. "Blue Banded — No Border"), which
// makes it structurally ambiguous for any consumer that resolves a style by
// an unanchored substring match on `name` (e.g. testing-library's
// `getByRole(..., { name: /pattern/ })`) while all variants are simultaneously
// present — no ordering can fully eliminate that ambiguity since it depends
// on the full displayed set, not position. Ordering suffixed entries first at
// least keeps low, fixed array indices (e.g. `TABLE_STYLES[0]`) pointing at
// unambiguous names.
const BORDER_VARIANTS: BorderVariantDescriptor[] = [
    { idSuffix: '-no-border', nameSuffix: ' — No Border', patch: NO_BORDER },
    { idSuffix: '-horizontal', nameSuffix: ' — Horizontal Lines', patch: HORIZONTAL_BORDER },
    { idSuffix: '', nameSuffix: '', patch: UNIFORM_BORDER },
];

const REGULAR_STYLES: RegularTableStyle[] = PALETTE.flatMap(({ hue, headerBg, tint }) =>
    VARIANTS.flatMap((variant) =>
        BORDER_VARIANTS.map((borderVariant) => ({
            kind: 'regular' as const,
            id: `${hue.toLowerCase()}-${variant.slug}${borderVariant.idSuffix}`,
            name: `${hue} ${variant.label}${borderVariant.nameSuffix}`,
            header: { backgroundColor: headerBg, color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: tint,
            border: borderVariant.patch,
            headerRow: variant.headerRow,
            headerColumn: variant.headerColumn,
            totalRow: variant.totalRow,
        }))
    )
);

// The "Clear formatting" 14 keys from HamburgerMenu.tsx's Format menu, union
// the 4 new border side keys.
const BLANK_STYLE: BlankTableStyle = {
    kind: 'blank',
    id: 'blank',
    name: 'Blank',
    clearPatch: {
        fontFamily: undefined,
        fontSize: undefined,
        fontWeight: undefined,
        fontStyle: undefined,
        textDecoration: undefined,
        color: undefined,
        backgroundColor: undefined,
        textAlign: undefined,
        verticalAlign: undefined,
        borderStyle: undefined,
        numberFormat: undefined,
        decimalPlaces: undefined,
        customFormat: undefined,
        wrapMode: undefined,
        borderTop: undefined,
        borderRight: undefined,
        borderBottom: undefined,
        borderLeft: undefined,
    },
};

export const TABLE_STYLES: TableStyle[] = [...REGULAR_STYLES, BLANK_STYLE];
