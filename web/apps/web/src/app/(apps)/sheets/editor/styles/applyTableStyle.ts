import type { CellStyle } from '../types';
import type { RegularTableStyle } from './tableStyles';
import { alphaToNum } from '../utils';

// Pure computation of the per-cell style patches produced by applying a
// RegularTableStyle preset to an arbitrary cell selection. No React, no side
// effects. Callers must branch on `style.kind` before calling this — a
// `BlankTableStyle` is handled separately via its `clearPatch`.
export function computeTableStylePatches(style: RegularTableStyle, cells: Set<string>): Map<string, Partial<CellStyle>> {
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    const parsed = new Map<string, { col: number; row: number }>();
    for (const id of cells) {
        const m = id.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        const col = alphaToNum(m[1]);
        const row = parseInt(m[2], 10);
        parsed.set(id, { col, row });
        if (col < minC) minC = col;
        if (col > maxC) maxC = col;
        if (row < minR) minR = row;
        if (row > maxR) maxR = row;
    }

    const headerLookPatch: Partial<CellStyle> = {
        backgroundColor: style.header.backgroundColor,
        color: style.header.color,
        fontWeight: 'bold',
        ...style.border,
    };

    const headerOffset = style.headerRow ? 1 : 0;
    const patches = new Map<string, Partial<CellStyle>>();

    for (const id of cells) {
        const coords = parsed.get(id);
        if (!coords) continue;
        const { col, row } = coords;

        const bodyRowIndex = row - minR - headerOffset;
        let patch: Partial<CellStyle> = {
            ...style.border,
            fontWeight: 'normal',
            color: undefined,
            backgroundColor: bodyRowIndex % 2 === 0 ? style.bandColorA : style.bandColorB,
        };

        if (style.headerColumn && col === minC) patch = headerLookPatch;
        if (style.headerRow && row === minR) patch = headerLookPatch;
        if (style.totalRow && row === maxR && maxR > minR) patch = headerLookPatch;

        patches.set(id, patch);
    }

    return patches;
}
