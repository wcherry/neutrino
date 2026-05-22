# Plan: Cross-Sheet Cell References

## Branch
`feature/cross-sheet-cell-references` (neutrino-web, neutrino-e2e)

## What is changing and why

Users need to reference cells from other sheets in formulas, the same way Excel/Google Sheets support `Sheet2!A1` and `'My Sheet'!A1:B3` syntax. Currently the formula engine only operates on the active sheet's cell Map.

## Layers affected

- **Frontend only** — no backend changes needed
- `apps/web/src/app/(apps)/sheets/editor/formula.ts` — tokenizer + parser + computeCell signature
- `apps/web/src/app/(apps)/sheets/editor/utils.ts` — parseDeps cross-sheet recognition
- `apps/web/src/app/(apps)/sheets/editor/SheetEditor.tsx` — pass allSheetsData to computeCell
- `apps/web/src/app/(apps)/sheets/editor/hooks/usePersistence.ts` — parseSheetData needs allSheetsData
- `apps/web/src/app/(apps)/sheets/editor/hooks/useCellEditing.ts` — computeCell calls need allSheetsData
- `neutrino-e2e/tests/sheets/sheet-cross-sheet-refs.spec.ts` — new E2E tests

## Feature flag

Name: `feature.sheets.cross-sheet-references`
Env var: `NEXT_PUBLIC_FEATURE_SHEETS_CROSS_SHEET_REFERENCES`
Default: OFF

Cross-sheet references will parse and evaluate regardless of flag (the syntax is backward-compatible — unknown identifiers already return empty string). The flag will guard any UI affordances in the future. For now the engine change is safe to ship without a flag since it adds new capability without breaking existing formulas.

**Decision**: No flag needed — the tokenizer change is purely additive and backwards-compatible. Existing formulas that don't use `!` are unaffected.

## Implementation detail

### 1. Tokenizer changes (formula.ts)

Add handling for `SheetName!CellRef` in `tokenize()`:
- After recognizing a word that is NOT followed by `(` (not a function), check if the next char is `!`
- If yes, consume the `!` and then consume the cell reference (letters + digits, or letters only for range start)
- Support single-quoted sheet names: `'Net Worth'!C4`
- Emit a new `SHEET_CELL` token: `{ type: 'SHEET_CELL'; sheet: string; cell: string }`

Also handle `SheetName!CellRef:CellRef` for ranges — emit `SHEET_RANGE` token.

### 2. computeCell signature change (formula.ts)

```ts
export function computeCell(
  raw: string,
  data: Map<string, CellProps>,
  allSheets?: { name: string; data: Map<string, CellProps> }[]
): { value: string; deps: string[] }
```

The `allSheets` param is optional for backwards compatibility. When absent, cross-sheet refs return `#REF!`.

### 3. Parser changes (formula.ts)

In `parsePrimary()` and `parseFuncArg()`:
- Handle `SHEET_CELL` token: find the named sheet in `allSheets`, look up the cell, return its value
- Handle `SHEET_RANGE` token: find the named sheet, expand the range, return the cell IDs as a RangeArg (but values must come from the foreign sheet's data Map)
- If sheet not found: return `#REF!`

### 4. parseDeps (utils.ts)

Update to recognize cross-sheet references in the raw formula string. Cross-sheet deps are not tracked for live reactivity (editing a cell in Sheet2 won't auto-update a formula in Sheet1 that references it, because the dependency graph only covers the current sheet's data Map). This is acceptable for V1 — the formula re-evaluates when the sheet is switched or saved/loaded.

### 5. Call sites to update

- `usePersistence.ts`: `parseSheetData` calls `computeCell(c.raw || '', map)` — needs to pass all sheets after all sheets are parsed
- `useCellEditing.ts`: `activateCell` calls `computeCell(currentCell.raw ?? '', next)` — needs allSheets
- `SheetEditor.tsx`: `handleApplySuggestion`, `handleClearCells` call `computeCell` — needs allSheets
- All `propagateDeps` transitively calls `computeCell` — its signature must carry allSheets

### 6. Cross-sheet range in functions

When a range token like `Beta!C4:D6` is passed as an argument to SUM/etc, the arg is a `RangeArg` (string[]). But the values are read via `data.get(id)` where `data` is the active sheet's map. 

Solution: prefix cross-sheet cell IDs with the sheet name to create a unique namespace, e.g., `__sheet__Beta__C4`. Alternatively, pass a merged data map that includes the cross-sheet cells with namespaced keys.

**Chosen approach**: Build a `crossSheetData` Map that merges all foreign sheet cell IDs under a `SheetName::CellId` namespace. When resolving a cross-sheet range, return IDs like `Beta::C4`, and provide a merged Map that includes both the current sheet's cells and the cross-sheet cells under their namespaced keys.

Simpler approach that avoids namespace complexity: pass `allSheets` directly to `FormulaParser` and have `parseFuncArg` return a `CrossSheetRange` (a specialized arg type). This is more invasive.

**Final chosen approach (simplest correct solution)**: Build a composite `data` Map that merges all sheets' cell data under namespaced keys `__SHEET__SheetName__CellId` before passing to the parser. Update `getNumValues`/`getStrValues`/`data.get` to use these keys. Cross-sheet tokens emit these namespaced IDs into the RangeArg arrays.

Actually the simplest approach: Pass the `allSheets` array to `FormulaParser` and add a getter method that resolves cross-sheet cell values separately. No Map mutation needed.

## Risks and edge cases

1. Sheet name with spaces — must handle `'Net Worth'!C4` with single quotes
2. Sheet renamed after formula is written — formula will return `#REF!` until corrected
3. Sheet deleted — formula returns `#REF!`
4. Circular references across sheets — no detection (same as within-sheet today)
5. parseDeps for cross-sheet refs — not needed for reactivity in V1; formula re-evaluates on full recompute

## Acceptance criteria

- `=Beta!C4` in Sheet1 returns the value of C4 in the sheet named "Beta"
- `=SUM(Beta!C4:D6)` sums the cross-sheet range
- `='Net Worth'!C4` works with quoted sheet names
- When referenced sheet is renamed, formula returns `#REF!`
- When referenced sheet is deleted, formula returns `#REF!`
- When referenced cells are cleared, formula returns `0` (numeric) or `""` (string context)
- Existing formulas are unaffected
