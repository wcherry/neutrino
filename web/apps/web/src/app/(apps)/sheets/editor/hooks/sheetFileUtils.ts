import type { CellProps, SheetFile } from '../types';
import { computeCell, type SheetRef } from '../formula';

/**
 * First pass: build a CellProps map from saved cell records, carrying over the
 * pre-computed value so formula lookups have a baseline during evaluation.
 */
export function buildRawSheetMap(sheetData: SheetFile['sheets'][0]): Map<string, CellProps> {
    return new Map(
        Object.values(sheetData.cells).map(c => [
            c.id,
            { id: c.id, raw: c.raw, value: c.value, edit: false, cellStyle: c.cellStyle,
                colSpan: c.colSpan, rowSpan: c.rowSpan, mergeAnchor: c.mergeAnchor },
        ])
    );
}

/**
 * Second pass: evaluate all formulas in a sheet with access to all sheets
 * (needed for cross-sheet references like =Beta!C4).
 * Mutates the map in-place so each cell sees freshly computed values from
 * cells evaluated earlier in iteration order, enabling formula chains to work.
 *
 * Also builds the reverse dependency graph: after evaluating every formula
 * the `dependents` array on each referenced cell is populated so that
 * propagateDeps can cascade recalculation when a cell value changes.
 */
export function evaluateSheetMap(map: Map<string, CellProps>, allSheets: SheetRef[]): Map<string, CellProps> {
    // Pass 1: evaluate formulas and collect deps for every cell.
    for (const [id, cell] of map) {
        const { value, deps } = computeCell(cell.raw || '', map, allSheets);
        map.set(id, { ...cell, value, deps });
    }
    // Pass 2: build the reverse dependency graph (dependents).
    // For every formula cell, register it as a dependent on each cell it references.
    for (const [id, cell] of map) {
        if (!cell.deps?.length) continue;
        for (const depId of cell.deps) {
            const referenced = map.get(depId) ?? { id: depId, value: '', raw: '', edit: false };
            const existingDependents = referenced.dependents ?? [];
            if (!existingDependents.includes(id)) {
                map.set(depId, { ...referenced, dependents: [...existingDependents, id] });
            }
        }
    }
    return map;
}

/**
 * Combinator on top of buildRawSheetMap/evaluateSheetMap: turns a persisted
 * SheetFile into the `{ name, data }[]` shape that `useSheets.replaceAllSheets`
 * / `handleImportSheet` expect, with full cross-sheet formula evaluation.
 */
export function sheetFileToSheetsData(file: SheetFile): { name: string; data: Map<string, CellProps> }[] {
    const rawSheets = file.sheets ?? [];
    if (rawSheets.length === 0) return [];
    const names = rawSheets.map((s, i) => s.name ?? `Sheet ${i + 1}`);
    const rawMaps = rawSheets.map(buildRawSheetMap);
    const allSheets: SheetRef[] = names.map((name, i) => ({ name, data: rawMaps[i] }));
    const allData = rawMaps.map(rawMap => evaluateSheetMap(rawMap, allSheets));
    return names.map((name, i) => ({ name, data: allData[i] }));
}
