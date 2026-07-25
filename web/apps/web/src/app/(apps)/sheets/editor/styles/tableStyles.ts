import type { CellStyle } from '../types';

export interface TableStyle {
    id: string;
    name: string;
    header: { backgroundColor: string; color: string };
    bandColorA: string;
    bandColorB: string;
    borderStyle: CellStyle['borderStyle'];
    headerRow: boolean;
    headerColumn: boolean;
    totalRow: boolean;
}

// 14-hue palette: hue name -> header background hex -> tint hex (bandColorB).
// bandColorA is always '#ffffff'; borderStyle is always 'thin'; header text is
// always white.
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

export const TABLE_STYLES: TableStyle[] = PALETTE.flatMap(({ hue, headerBg, tint }) =>
    VARIANTS.map((variant) => ({
        id: `${hue.toLowerCase()}-${variant.slug}`,
        name: `${hue} ${variant.label}`,
        header: { backgroundColor: headerBg, color: '#ffffff' },
        bandColorA: '#ffffff',
        bandColorB: tint,
        borderStyle: 'thin' as const,
        headerRow: variant.headerRow,
        headerColumn: variant.headerColumn,
        totalRow: variant.totalRow,
    }))
);
