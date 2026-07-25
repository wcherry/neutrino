# Manual Verification: Sheets structural insert/delete no longer leaves unstyled gaps

## Prerequisites
- [ ] A logged-in account (register or sign in) with access to create a new spreadsheet.
- [ ] Sheets editor dev server running locally.

## Steps to Verify

### Happy path — row insert
1. Create a new spreadsheet.
2. Select a rectangular range, e.g. `A1:D6`.
3. Click the "Table styles" toolbar button (grid icon) and choose any style with
   header row + header column + total row (e.g. "Blue Header & Totals").
   - Row 1 (header) and row 6 (total row) should be solid dark with white text.
   - Column A should be solid dark for every row (header column).
   - Rows 2–5 in columns B–D should alternate white/tinted (banding).
4. Right-click a row number in the middle of the table (e.g. row 5) and choose
   "Insert row above".
5. Right-click a column letter in the middle of the table (e.g. column C) and
   choose "Insert column left".

### Edge Cases
1. Delete a row/column in the middle of the table via the same context menus
   ("Delete row" / "Delete column") and confirm the table shrinks by one
   row/column with header/total-row/banding still correct (no leftover stale
   dark cells outside the new bounds).
2. Apply a table style to a selection, then delete the row that was the total
   row (the last row) — the row above it should become the new total row and
   pick up the dark styling automatically.
3. Merge a couple of cells inside a plain (non-table) range, then insert a row
   above the merge — the merge should not silently split; either the whole
   merge shifts down together, or (if the insertion point lands exactly on the
   merge's anchor row) the anchor cell is dropped like any other cell at that
   position (documented, not a bug).
4. With a conditional-formatting rule active on a range, insert/delete a
   row/column that intersects the rule's range — the rule's range should
   grow/shrink/shift correctly (open the Conditional Formatting dialog to
   confirm the range string updated).

## Expected Results
- No unstyled ("blank white") gap ever appears in place of the new row/column
  — it is immediately styled consistently with its neighbors (correct band
  color, and header-column/header-row/total-row treatment where applicable).
- The header row stays at the top; the total row (if present) always ends up
  on the true last row of the table, even after the table's size changes.
- Column widths / row heights set explicitly on cells shift with the
  insert/delete (0-based `colWidths`/`rowHeights` maps stay aligned with the
  1-based cell grid).
- A single `Ctrl+Z` immediately after any insert/delete undoes the entire
  operation — cell shift *and* table recoloring — in one step; the sheet is
  pixel-for-pixel identical to before the edit.
- No new console errors during any of the above (a pre-existing, unrelated
  401 on a websocket presence call and the "encryption key unavailable"
  autosave toast on a fresh unshared doc are expected noise, not regressions).

## Actual results from automated manual verification (Playwright against the local dev server)

Performed against `http://localhost:3000` with a fresh registered account and a
new spreadsheet, using the "Blue Header & Totals" style (header row + header
column + total row) on `A1:D6`:

- **Row insert** ("Insert row above" via the row-header context menu on a
  middle row): the newly-created row was immediately dark in column A and
  correctly tinted in columns B–D (matching the recomputed band parity) — no
  unstyled gap. The row that shifted down to become the new last row
  (previously a plain banded row) was correctly recomputed as the dark total
  row. Verified via both `getComputedStyle(...).backgroundColor` reads and
  screenshots.
- **Column insert** ("Insert column left" via the column-header context menu
  on a middle column): after the insert, both the header row (`A1..E1`) and
  the total row (`A6..E6`) were solid dark across all 5 columns, including the
  new column — no gap in either the header or total-row banding.
- **Undo**: a single `Ctrl+Z` after each insert fully reverted the sheet —
  cell positions, table region bounds, and all recomputed colors matched the
  pre-insert state exactly (confirmed by re-reading the same cells' computed
  background colors, and by the newly-added column/row's cells reporting
  `rgba(0, 0, 0, 0)` — i.e. no longer existing — after undo).
- Only console output was the pre-existing, unrelated 401 on the presence
  websocket handshake (same in the baseline app, unaffected by this change).

### Bug found and fixed during this verification pass

The first pass of manual verification caught a real bug: `runStructuralShift`
originally computed `computeStructuralShift(...)` and called the
`colWidths`/`rowHeights`/CF/table-region setters **inside** a
`setData(prev => ...)` functional updater. React is allowed to invoke updater
functions more than once for a single state update (observed directly via a
temporary debug log: it fired twice against the dev server), and because the
updater's body had side effects (mutating `tableRegionsRef.current` via
`tableRegions.updateTableRegions`), the second invocation shifted an
already-shifted table region a second time — silently corrupting the
recomputed colors (e.g. the total row would render as a normal banded row
instead of the dark total-row style).

Fixed by reading the current cells from `dataRef.current` (the same
stable-ref pattern already used elsewhere in `SheetEditor.tsx`) and moving the
entire computation and all the setter calls out of any updater function, so
`runStructuralShift` runs its logic exactly once per invocation regardless of
how many times React might otherwise re-invoke an updater. Re-verified after
the fix: all the "Actual results" above reflect the corrected behavior.
