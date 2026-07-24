/**
 * Unit tests for sheetFileUtils.ts (TDD red phase — module does not exist yet).
 *
 * `buildRawSheetMap` and `evaluateSheetMap` are being moved verbatim out of
 * `usePersistence.ts` (where they are currently private, unexported helpers)
 * into a new standalone module, `../../app/(apps)/sheets/editor/hooks/sheetFileUtils.ts`,
 * and exported. A new combinator, `sheetFileToSheetsData`, is added on top of
 * them to turn a persisted `SheetFile` into the `{ name, data }[]` shape that
 * `useSheets.replaceAllSheets` / `handleImportSheet` expect, with full
 * cross-sheet formula evaluation.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * for the full plan this test file is written against.
 */

import { describe, it, expect } from 'vitest';
import {
    buildRawSheetMap,
    evaluateSheetMap,
    sheetFileToSheetsData,
} from '../../app/(apps)/sheets/editor/hooks/sheetFileUtils';
import type { CellProps, SheetFile, SavedCell } from '../../app/(apps)/sheets/editor/types';
import type { SheetRef } from '../../app/(apps)/sheets/editor/formula';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function savedCell(overrides: Partial<SavedCell> & { id: string }): SavedCell {
    return { ...overrides };
}

function sheetData(cells: SavedCell[], name = 'Sheet1'): SheetFile['sheets'][0] {
    const record: Record<string, SavedCell> = {};
    for (const c of cells) record[c.id] = c;
    return { name, cells: record };
}

// ── buildRawSheetMap ─────────────────────────────────────────────────────────

describe('buildRawSheetMap', () => {
    it('carries over raw, value, cellStyle, colSpan, rowSpan, mergeAnchor and sets edit: false', () => {
        const data = sheetData([
            savedCell({
                id: 'A1',
                raw: '=B1+1',
                value: '4',
                cellStyle: { fontWeight: 'bold', backgroundColor: '#fff' },
                colSpan: 2,
                rowSpan: 1,
                mergeAnchor: undefined,
            }),
        ]);

        const map = buildRawSheetMap(data);

        expect(map.get('A1')).toEqual<CellProps>({
            id: 'A1',
            raw: '=B1+1',
            value: '4',
            edit: false,
            cellStyle: { fontWeight: 'bold', backgroundColor: '#fff' },
            colSpan: 2,
            rowSpan: 1,
            mergeAnchor: undefined,
        });
    });

    it('sets edit: false even for cells with no style/span metadata', () => {
        const data = sheetData([savedCell({ id: 'B2', raw: 'hello', value: 'hello' })]);
        const map = buildRawSheetMap(data);
        const cell = map.get('B2');
        expect(cell?.edit).toBe(false);
        expect(cell?.raw).toBe('hello');
        expect(cell?.value).toBe('hello');
    });

    it('carries over mergeAnchor for a merged (non-anchor) cell', () => {
        const data = sheetData([
            savedCell({ id: 'C3', raw: '', value: '', mergeAnchor: 'C2' }),
        ]);
        const map = buildRawSheetMap(data);
        expect(map.get('C3')?.mergeAnchor).toBe('C2');
    });

    it('builds one map entry per cell in the input record', () => {
        const data = sheetData([
            savedCell({ id: 'A1', raw: '1' }),
            savedCell({ id: 'A2', raw: '2' }),
            savedCell({ id: 'A3', raw: '3' }),
        ]);
        const map = buildRawSheetMap(data);
        expect(map.size).toBe(3);
        expect([...map.keys()].sort()).toEqual(['A1', 'A2', 'A3']);
    });
});

// ── evaluateSheetMap ─────────────────────────────────────────────────────────

describe('evaluateSheetMap', () => {
    it('computes a simple arithmetic formula (=A1+B1)', () => {
        const data = sheetData([
            savedCell({ id: 'A1', raw: '2' }),
            savedCell({ id: 'B1', raw: '3' }),
            savedCell({ id: 'C1', raw: '=A1+B1' }),
        ]);
        const map = buildRawSheetMap(data);
        const allSheets: SheetRef[] = [{ name: 'Sheet1', data: map }];

        const result = evaluateSheetMap(map, allSheets);

        expect(result.get('C1')?.value).toBe('5');
    });

    it('computes a SUM over a range', () => {
        const data = sheetData([
            savedCell({ id: 'B2', raw: '1' }),
            savedCell({ id: 'B3', raw: '2' }),
            savedCell({ id: 'B4', raw: '3' }),
            savedCell({ id: 'B5', raw: '4' }),
            savedCell({ id: 'C1', raw: '=SUM(B2:B5)' }),
        ]);
        const map = buildRawSheetMap(data);
        const allSheets: SheetRef[] = [{ name: 'Sheet1', data: map }];

        const result = evaluateSheetMap(map, allSheets);

        expect(result.get('C1')?.value).toBe('10');
    });

    it('builds the reverse dependents graph on cells referenced by a formula', () => {
        const data = sheetData([
            savedCell({ id: 'A1', raw: '2' }),
            savedCell({ id: 'B1', raw: '3' }),
            savedCell({ id: 'C1', raw: '=A1+B1' }),
        ]);
        const map = buildRawSheetMap(data);
        const allSheets: SheetRef[] = [{ name: 'Sheet1', data: map }];

        const result = evaluateSheetMap(map, allSheets);

        expect(result.get('A1')?.dependents).toContain('C1');
        expect(result.get('B1')?.dependents).toContain('C1');
    });

    it('mutates and returns the same map instance', () => {
        const data = sheetData([savedCell({ id: 'A1', raw: '1' })]);
        const map = buildRawSheetMap(data);
        const result = evaluateSheetMap(map, [{ name: 'Sheet1', data: map }]);
        expect(result).toBe(map);
    });
});

// ── sheetFileToSheetsData ────────────────────────────────────────────────────

describe('sheetFileToSheetsData', () => {
    it('returns one { name, data } entry per sheet, with correct names', () => {
        const file: SheetFile = {
            sheets: [
                sheetData([savedCell({ id: 'A1', raw: '10' })], 'Alpha'),
                sheetData([savedCell({ id: 'A1', raw: '20' })], 'Beta'),
            ],
        };

        const result = sheetFileToSheetsData(file);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('Alpha');
        expect(result[1].name).toBe('Beta');
        expect(result[0].data).toBeInstanceOf(Map);
        expect(result[1].data).toBeInstanceOf(Map);
    });

    it('resolves a cross-sheet formula reference (Sheet2 referencing Sheet1)', () => {
        const file: SheetFile = {
            sheets: [
                sheetData([savedCell({ id: 'A1', raw: '10' })], 'Sheet1'),
                sheetData([savedCell({ id: 'C4', raw: '=Sheet1!A1+5' })], 'Sheet2'),
            ],
        };

        const result = sheetFileToSheetsData(file);

        const sheet2 = result.find(s => s.name === 'Sheet2');
        expect(sheet2?.data.get('C4')?.value).toBe('15');
    });

    it('evaluates plain (non-cross-sheet) formulas within each sheet too', () => {
        const file: SheetFile = {
            sheets: [
                sheetData(
                    [
                        savedCell({ id: 'A1', raw: '4' }),
                        savedCell({ id: 'A2', raw: '6' }),
                        savedCell({ id: 'A3', raw: '=A1+A2' }),
                    ],
                    'Sheet1',
                ),
            ],
        };

        const result = sheetFileToSheetsData(file);

        expect(result[0].data.get('A3')?.value).toBe('10');
    });

    it('returns [] for an empty sheets array', () => {
        const file: SheetFile = { sheets: [] };
        expect(sheetFileToSheetsData(file)).toEqual([]);
    });

    it('returns [] when the sheets field is missing entirely', () => {
        const file = {} as SheetFile;
        expect(sheetFileToSheetsData(file)).toEqual([]);
    });
});
