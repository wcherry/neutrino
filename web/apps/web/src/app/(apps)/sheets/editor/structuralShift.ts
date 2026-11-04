// Pure functions (no React) implementing the unified structural insert/delete
// shift used by every row/col insert/delete handler in SheetEditor.tsx.
//
// See /Users/williamcherry/Playground/getneutrino.app/neutrino/agent_docs/plans/fix-sheets-structural-shift.md
// for full background. Summary:
//
// - `index` is always 1-based (matches cell-id numbering, e.g. col B = 2).
//   Insert: coordinate >= index shifts by +1. Delete: coordinate === index is
//   dropped; coordinate > index shifts by -1.
// - Merge anchors (rowSpan/colSpan > 1) only get special grow/shrink treatment
//   when the edit index falls strictly inside the span. Otherwise they ride
//   along with the normal per-cell shift like any other cell.
// - `colWidths`/`rowHeights` are keyed 0-based; the 1-based `index` is
//   converted internally.
// - Formula references follow the cells they point at (`shiftFormula`), including
//   references to this sheet from other tabs (`shiftReferencesFromOtherSheet`).
//   Both only rewrite text: `rebuildFormulaGraph` then brings deps, dependents
//   and values back in line, once, however many shifts a single edit chained.
// - `computeStructuralShift` is the orchestrator that also recomputes table
//   style patches for every surviving TableRegion against its new bounds —
//   this is what prevents an unstyled gap after a structural edit.

import type { CellProps, CFRule, TableRegion } from './types';
import { parseCellId, numToAlpha, alphaToNum, parseDeps } from './utils';
import { computeCell, propagateDeps, type SheetRef } from './formula';
import { TABLE_STYLES } from './styles/tableStyles';
import { computeTableStylePatches } from './styles/applyTableStyle';

type Axis = 'row' | 'col';
type StructuralOp = 'insert' | 'delete';

// ── shiftedId ────────────────────────────────────────────────────────────────

export function shiftedId(id: string, axis: Axis, op: StructuralOp, index: number): string | null {
    const parsed = parseCellId(id);
    if (!parsed) return id;
    const { col, row } = parsed;
    const coord = axis === 'row' ? row : col;

    let newCoord = coord;
    if (op === 'insert') {
        if (coord >= index) newCoord = coord + 1;
    } else {
        if (coord === index) return null;
        if (coord > index) newCoord = coord - 1;
    }

    return axis === 'row' ? `${numToAlpha(col)}${newCoord}` : `${numToAlpha(newCoord)}${row}`;
}

// ── shiftCellMap ─────────────────────────────────────────────────────────────

type SpanKey = 'rowSpan' | 'colSpan';

export function shiftCellMap(cells: Map<string, CellProps>, axis: Axis, op: StructuralOp, index: number): Map<string, CellProps> {
    const spanKey: SpanKey = axis === 'row' ? 'rowSpan' : 'colSpan';
    const otherSpanKey: SpanKey = axis === 'row' ? 'colSpan' : 'rowSpan';

    // Pass 0: identify merge anchors (in original coordinates) and whether the
    // edit index falls strictly inside their span along this axis.
    const anchorInfo = new Map<string, { newId: string | null; newSpan: number | undefined }>();
    for (const [id, c] of cells) {
        const span = c[spanKey];
        if (!span || span <= 1) continue;
        const parsed = parseCellId(id);
        if (!parsed) continue;
        const anchorMin = axis === 'row' ? parsed.row : parsed.col;
        const anchorMax = anchorMin + span - 1;
        const strictlyInside = anchorMin < index && index <= anchorMax;
        const newId = shiftedId(id, axis, op, index);
        let newSpan: number | undefined = span;
        if (strictlyInside) {
            newSpan = op === 'insert' ? span + 1 : span - 1;
            if (newSpan <= 1) newSpan = undefined;
        }
        anchorInfo.set(id, { newId, newSpan });
    }

    // Pass 1: shift every cell to its new id, applying the span override for
    // identified anchors (the id itself is unaffected by the special-case,
    // since strictlyInside implies anchorMin < index, which the generic shift
    // already leaves untouched on both insert and delete).
    const shifted = new Map<string, CellProps>();
    for (const [id, c] of cells) {
        const newId = shiftedId(id, axis, op, index);
        if (newId === null) continue;
        let newCell: CellProps = { ...c, id: newId };
        const info = anchorInfo.get(id);
        if (info) {
            newCell = { ...newCell, [spanKey]: info.newSpan };
        }
        shifted.set(newId, newCell);
    }

    // Pass 2: fix up mergeAnchor pointers on member cells.
    const result = new Map<string, CellProps>();
    for (const [newId, c] of shifted) {
        if (!c.mergeAnchor) {
            result.set(newId, c);
            continue;
        }
        const oldAnchorId = c.mergeAnchor;
        const info = anchorInfo.get(oldAnchorId);
        let newAnchorId: string | null;
        let anchorStillMerge: boolean;
        if (info) {
            newAnchorId = info.newId;
            const anchorCell = cells.get(oldAnchorId);
            const otherSpan = anchorCell?.[otherSpanKey];
            anchorStillMerge = (info.newSpan ?? 1) > 1 || (otherSpan ?? 1) > 1;
        } else {
            newAnchorId = shiftedId(oldAnchorId, axis, op, index);
            anchorStillMerge = newAnchorId !== null;
        }
        if (newAnchorId === null || !anchorStillMerge) {
            result.set(newId, { ...c, mergeAnchor: undefined });
        } else {
            result.set(newId, { ...c, mergeAnchor: newAnchorId });
        }
    }

    return result;
}

// ── shiftRect ────────────────────────────────────────────────────────────────

export type RectBounds = { minR: number; maxR: number; minC: number; maxC: number };

export function shiftRect(bounds: RectBounds, axis: Axis, op: StructuralOp, index: number): RectBounds | null {
    if (axis === 'row') {
        const { minR, maxR } = bounds;
        let newMinR = minR, newMaxR = maxR;
        if (op === 'insert') {
            if (index <= minR) {
                newMinR = minR + 1;
                newMaxR = maxR + 1;
            } else if (index <= maxR) {
                newMaxR = maxR + 1;
            }
        } else {
            if (index < minR) {
                newMinR = minR - 1;
                newMaxR = maxR - 1;
            } else if (index <= maxR) {
                newMaxR = maxR - 1;
                if (newMaxR < newMinR) return null;
            }
        }
        return { ...bounds, minR: newMinR, maxR: newMaxR };
    }

    const { minC, maxC } = bounds;
    let newMinC = minC, newMaxC = maxC;
    if (op === 'insert') {
        if (index <= minC) {
            newMinC = minC + 1;
            newMaxC = maxC + 1;
        } else if (index <= maxC) {
            newMaxC = maxC + 1;
        }
    } else {
        if (index < minC) {
            newMinC = minC - 1;
            newMaxC = maxC - 1;
        } else if (index <= maxC) {
            newMaxC = maxC - 1;
            if (newMaxC < newMinC) return null;
        }
    }
    return { ...bounds, minC: newMinC, maxC: newMaxC };
}

// ── shiftIndexMap ────────────────────────────────────────────────────────────

// colWidths/rowHeights are keyed 0-based; `index` is 1-based, so it's
// converted to the 0-based key space internally.
export function shiftIndexMap(map: Map<number, number>, op: StructuralOp, index: number): Map<number, number> {
    const zeroBasedIndex = index - 1;
    const result = new Map<number, number>();
    for (const [key, value] of map) {
        if (op === 'insert') {
            result.set(key >= zeroBasedIndex ? key + 1 : key, value);
        } else {
            if (key === zeroBasedIndex) continue;
            result.set(key > zeroBasedIndex ? key - 1 : key, value);
        }
    }
    return result;
}

// ── parseRangeToBounds / boundsToRange ───────────────────────────────────────

export function parseRangeToBounds(range: string): RectBounds | null {
    const parts = range.split(':');
    if (parts.length === 1) {
        const p = parseCellId(parts[0]);
        if (!p) return null;
        return { minR: p.row, maxR: p.row, minC: p.col, maxC: p.col };
    }
    if (parts.length === 2) {
        const a = parseCellId(parts[0]);
        const b = parseCellId(parts[1]);
        if (!a || !b) return null;
        return {
            minR: Math.min(a.row, b.row),
            maxR: Math.max(a.row, b.row),
            minC: Math.min(a.col, b.col),
            maxC: Math.max(a.col, b.col),
        };
    }
    return null;
}

export function boundsToRange(bounds: RectBounds): string {
    const start = `${numToAlpha(bounds.minC)}${bounds.minR}`;
    const end = `${numToAlpha(bounds.maxC)}${bounds.maxR}`;
    return start === end ? start : `${start}:${end}`;
}

// ── shiftFormula ─────────────────────────────────────────────────────────────

// A string literal, which is skipped, or a reference: an optional sheet prefix,
// then a cell or range. The lookarounds keep identifiers and function names that
// merely contain a reference (`LOG10(`, `Q1_total`) from matching.
const FORMULA_REFERENCE =
    /"[^"]*"|(?<![A-Za-z0-9_$.'])(?:('[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?(\$?)([A-Za-z]+)(\$?)(\d+)(?::(\$?)([A-Za-z]+)(\$?)(\d+))?(?![A-Za-z0-9_(!])/g;

// `target` is the sheet being edited. References with no sheet prefix resolve to
// the sheet holding the formula, so they move only if that sheet is the target.
export type FormulaShiftScope = { target?: string; formulaOnTarget: boolean };

/**
 * Rewrites one formula for a row or column inserted or deleted: a reference moves
 * with its cell, a range grows or shrinks around the edit, and a reference to a
 * deleted cell becomes #REF!. Absolute ($) references move too, because $ pins a
 * reference against being copied, not against the sheet changing under it.
 */
export function shiftFormula(
    formula: string,
    axis: Axis,
    op: StructuralOp,
    index: number,
    scope: FormulaShiftScope = { formulaOnTarget: true },
): string {
    const target = scope.target?.toLowerCase();
    return formula.replace(FORMULA_REFERENCE, (match, prefix: string | undefined, d1: string, col1: string, d2: string, row1: string, d3: string | undefined, col2: string | undefined, d4: string | undefined, row2: string | undefined) => {
        if (col1 === undefined) return match; // string literal
        const onTarget = prefix === undefined
            ? scope.formulaOnTarget
            : prefix.replace(/^'|'$/g, '').toLowerCase() === target;
        if (!onTarget) return match;

        const isRange = col2 !== undefined;
        const c1 = alphaToNum(col1.toUpperCase()), r1 = parseInt(row1, 10);
        const c2 = isRange ? alphaToNum(col2.toUpperCase()) : c1;
        const r2 = isRange ? parseInt(row2!, 10) : r1;
        const bounds: RectBounds = {
            minR: Math.min(r1, r2), maxR: Math.max(r1, r2),
            minC: Math.min(c1, c2), maxC: Math.max(c1, c2),
        };
        const shifted = shiftRect(bounds, axis, op, index);
        if (shifted === null) return '#REF!';
        if (shifted.minR === bounds.minR && shifted.maxR === bounds.maxR &&
            shifted.minC === bounds.minC && shifted.maxC === bounds.maxC) return match;

        // A range may be written back to front (B3:A1); keep it that way round.
        const start = `${d1}${numToAlpha(c1 <= c2 ? shifted.minC : shifted.maxC)}${d2}${r1 <= r2 ? shifted.minR : shifted.maxR}`;
        const sheet = prefix === undefined ? '' : `${prefix}!`;
        if (!isRange) return `${sheet}${start}`;
        return `${sheet}${start}:${d3}${numToAlpha(c1 <= c2 ? shifted.maxC : shifted.minC)}${d4}${r1 <= r2 ? shifted.maxR : shifted.minR}`;
    });
}

/** The same edit as seen from another tab: only references naming `target` move. Null if nothing did. */
export function shiftReferencesFromOtherSheet(
    cells: Map<string, CellProps>,
    target: string,
    axis: Axis,
    op: StructuralOp,
    index: number,
): Map<string, CellProps> | null {
    let result: Map<string, CellProps> | null = null;
    for (const [id, cell] of cells) {
        if (!cell.raw?.startsWith('=')) continue;
        const raw = shiftFormula(cell.raw, axis, op, index, { target, formulaOnTarget: false });
        if (raw === cell.raw) continue;
        result ??= new Map(cells);
        result.set(id, { ...cell, raw });
    }
    return result;
}

/**
 * Brings deps, dependents and values back in line after formulas were rewritten
 * or cells moved. Mutates `cells`. Only a value that actually changed cascades:
 * inserting a row near the top of a long chain rewrites every formula in it
 * without changing any result, and that must not cost a recalculation per cell.
 */
export function rebuildFormulaGraph(cells: Map<string, CellProps>, allSheets?: SheetRef[]): void {
    const formulaIds: string[] = [];
    for (const [id, cell] of cells) {
        const deps = parseDeps(cell.raw ?? '');
        if (cell.raw?.startsWith('=')) formulaIds.push(id);
        cells.set(id, { ...cell, deps, dependents: [] });
    }
    for (const id of formulaIds) {
        for (const depId of cells.get(id)!.deps ?? []) {
            const referenced = cells.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
            cells.set(depId, { ...referenced, dependents: [...(referenced.dependents ?? []), id] });
        }
    }
    for (const id of formulaIds) {
        const cell = cells.get(id)!;
        const { value } = computeCell(cell.raw ?? '', cells, allSheets);
        if (value === cell.value) continue;
        cells.set(id, { ...cell, value });
        propagateDeps(id, cells, new Set([id]), allSheets);
    }
}

// ── shiftCFRules ─────────────────────────────────────────────────────────────

export function shiftCFRules(rules: CFRule[], axis: Axis, op: StructuralOp, index: number): CFRule[] {
    const result: CFRule[] = [];
    for (const rule of rules) {
        const bounds = parseRangeToBounds(rule.range);
        if (!bounds) {
            result.push(rule);
            continue;
        }
        const shifted = shiftRect(bounds, axis, op, index);
        if (shifted === null) continue;
        const shiftedRule = rule.rule.kind === 'formula'
            ? { ...rule.rule, formula: shiftFormula(rule.rule.formula, axis, op, index) }
            : rule.rule;
        result.push({ ...rule, range: boundsToRange(shifted), rule: shiftedRule });
    }
    return result;
}

// ── computeStructuralShift ───────────────────────────────────────────────────

export type StructuralShiftInput = {
    cells: Map<string, CellProps>;
    colWidths: Map<number, number>;
    rowHeights: Map<number, number>;
    conditionalFormats: CFRule[];
    tableRegions: TableRegion[];
    axis: Axis;
    op: StructuralOp;
    index: number;
    sheetName?: string;
};

export type StructuralShiftResult = {
    cells: Map<string, CellProps>;
    colWidths: Map<number, number>;
    rowHeights: Map<number, number>;
    conditionalFormats: CFRule[];
    tableRegions: TableRegion[];
};

export function computeStructuralShift(input: StructuralShiftInput): StructuralShiftResult {
    const { cells, colWidths, rowHeights, conditionalFormats, tableRegions, axis, op, index, sheetName } = input;

    const resultCells = shiftCellMap(cells, axis, op, index);
    for (const [id, cell] of resultCells) {
        if (!cell.raw?.startsWith('=')) continue;
        const raw = shiftFormula(cell.raw, axis, op, index, { target: sheetName, formulaOnTarget: true });
        if (raw !== cell.raw) resultCells.set(id, { ...cell, raw });
    }

    const newTableRegions: TableRegion[] = [];
    for (const region of tableRegions) {
        const bounds: RectBounds = { minR: region.minR, maxR: region.maxR, minC: region.minC, maxC: region.maxC };
        const shifted = shiftRect(bounds, axis, op, index);
        if (shifted === null) continue;

        const newRegion: TableRegion = {
            id: region.id,
            styleId: region.styleId,
            minR: shifted.minR,
            maxR: shifted.maxR,
            minC: shifted.minC,
            maxC: shifted.maxC,
        };
        newTableRegions.push(newRegion);

        const style = TABLE_STYLES.find(s => s.id === region.styleId);
        if (!style || style.kind !== 'regular') continue;

        const regionCellIds = new Set<string>();
        for (let r = newRegion.minR; r <= newRegion.maxR; r++) {
            for (let c = newRegion.minC; c <= newRegion.maxC; c++) {
                regionCellIds.add(`${numToAlpha(c)}${r}`);
            }
        }
        const patches = computeTableStylePatches(style, regionCellIds);
        for (const [id, patch] of patches) {
            const existing = resultCells.get(id) ?? { id, value: '', raw: '', edit: false };
            resultCells.set(id, { ...existing, cellStyle: { ...existing.cellStyle, ...patch } });
        }
    }

    const newColWidths = axis === 'col' ? shiftIndexMap(colWidths, op, index) : new Map(colWidths);
    const newRowHeights = axis === 'row' ? shiftIndexMap(rowHeights, op, index) : new Map(rowHeights);
    const newConditionalFormats = shiftCFRules(conditionalFormats, axis, op, index);

    return {
        cells: resultCells,
        colWidths: newColWidths,
        rowHeights: newRowHeights,
        conditionalFormats: newConditionalFormats,
        tableRegions: newTableRegions,
    };
}
