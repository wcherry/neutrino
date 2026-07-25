# Fix: Sheets structural insert/delete leaves unstyled gaps + other row/col-indexed data goes stale

Branch: `fix/sheets-structural-shift`
Area: `web/apps/web/src/app/(apps)/sheets/editor/`

## 1. What's changing and why

**Reported bug**: inserting a row/column in the middle of a table with a "table style"
preset applied (`TableStyleGalleryModal` → `computeTableStylePatches` →
`editing.applyStyleMap`, from PR #54/#55, now on `main`) produces an unstyled gap —
the new row/column has no formatting, and header/total-row coloring doesn't follow
the table's new shape.

**Root cause**: table styles are a one-time paint of `CellStyle` onto specific cell
IDs. There is no persisted concept of "this range is a table," so nothing recomputes
styling when rows/columns move. This is one symptom of a larger, pre-existing gap:
the 12 insert/delete row/column handlers in `SheetEditor.tsx` only shift the cell
`Map`'s keys — they don't touch merge anchors, conditional-formatting ranges, or
`colWidths`/`rowHeights`, all of which are also row/col-indexed and go stale on
structural edits. The user asked for the general fix, not just a table-styles patch.

## 2. Current state (confirmed by reading the code, 2026-07-24)

- `origin/feature/sheets-table-styles` (PR #54) is **merged** into `main` (`gh pr
  view 54` shows `state: MERGED`; `git diff origin/main origin/feature/sheets-table-styles`
  is empty — main already contains everything from that branch, plus PR #55 on top).
  Branching from fresh `main` is correct; there is no live PR #54 to rebase onto.
- 12 duplicated handlers in `SheetEditor.tsx`, two families, six operations each:
  - Cell-menu family (`contextMenu.cellId` is the anchor): `handleInsertRowAbove`
    (843), `handleInsertRowBelow` (867), `handleInsertColLeft` (891),
    `handleInsertColRight` (915), `handleDeleteRow` (939), `handleDeleteCol` (964).
  - Header-menu family (`headerContextMenu.index`, 0-based, is the anchor):
    `handleHeaderInsertRowAbove` (1135), `handleHeaderInsertRowBelow` (1157),
    `handleHeaderDeleteRow` (1179), `handleHeaderInsertColLeft` (1235),
    `handleHeaderInsertColRight` (1257), `handleHeaderDeleteCol` (1279).
  - All 12 do the same O(n) full-`Map` rebuild: regex-parse each id, shift
    row/col by ±1 relative to a threshold, drop the row/col being deleted.
    Formula rewriting is explicitly **not** attempted anywhere — out of scope,
    leave as-is.
  - Each handler's threshold reduces to a single unified "insertion index"
    (1-based, same numbering as cell ids): rows/cols `>= index` shift by +1 on
    insert; the row/col `=== index` is dropped and rows/cols `> index` shift by
    -1 on delete. I verified this against all 12 handlers' literal conditions
    (e.g. `handleInsertRowBelow` uses `rowN = pos.row` but shifts `r >= rowN + 1`,
    i.e. `index = pos.row + 1`; `handleHeaderInsertRowBelow` uses
    `index = headerContextMenu.index + 2`). This unification is what lets one
    shared function replace all 12 bodies — only the "which index" computation
    stays per-handler.
- Not shifted by any of the 12 handlers today (confirmed by grep — zero hits):
  1. **Merge anchors** — `mergeAnchor` (a cell-id string, `types.ts:218`,
     set by `mergeCells` in `hooks/useCellEditing.ts:570-632`) goes stale on any
     shift of the anchor's key.
  2. **Conditional formatting** — `CFRule.range` (`"A1:B10"` string) lives in
     `useConditionalFormatting.ts`'s per-sheet `sheetsConditionalFormatsRef` /
     `conditionalFormats` state, entirely separate from the cell `Map`.
  3. **colWidths / rowHeights** — `Map<number, number>` keyed by **0-based**
     index (confirmed: `handleHeaderHideRow` does
     `setRowHeights(prev => { ...; next.set(idx, 0); })` using
     `headerContextMenu.index` directly, no `+1`) — vs. cell ids and the new
     insertion `index` above, which are 1-based. Any shift math touching these
     maps must convert.
  4. Charts, column filters, frozen rows/cols (doesn't exist), and the
     sheet-delete/duplicate/reorder per-sheet-array desync (chart/CF arrays
     don't stay aligned with sheet indices across delete/duplicate/reorder) —
     confirmed pre-existing gaps, **explicitly out of scope**, not to be
     touched or worsened.
- `SheetData` (`types.ts:193-202`) and `usePersistence.ts`'s `serialize()`
  (132-164) / `load()` (300-471) already do this exact "optional field,
  per-sheet ref array, flush/restore in lockstep with `conditionalFormats`"
  dance for `conditionalFormats`/`charts` — `useTableRegions.ts` will copy
  `useConditionalFormatting.ts`'s shape exactly, and its wiring into
  `usePersistence`/`SheetEditor` copies the `cf.*` call sites exactly
  (`SheetEditor.tsx:1846-1891`, the `SheetTabBar` `onSwitchSheet`/`onAddSheet`
  handlers — note `onDeleteSheet`/`onDuplicateSheet`/`onMoveSheet` do **not**
  flush/switch CF today, confirming the desync gap in (4); table regions will
  match that, not fix it).
- Undo: all 12 handlers use the legacy full-snapshot path
  (`history.pushToUndo(new Map(prev))` then `setData(next)`, one atomic step
  for cell data only). CF/colWidths/rowHeights are separate React state, never
  in the undo stack, today. Not building general transactional undo — just
  keeping the cell-map shift + table-region recompute inside one `setData`
  call (so table styling undoes with the structural edit, since it's cell
  data), and leaving CF/colWidths/rowHeights exactly as un-undo-tracked as
  they already are.
- Style-gallery hookup: `StyleToolbar.tsx:419-427` renders
  `TableStyleGalleryModal` and its `onSelect` calls
  `onApplyStyleMap(computeTableStylePatches(style, selectedCells))` where
  `onApplyStyleMap` is `editing.applyStyleMap` from `SheetEditor.tsx:1760`.
  `selectedCells` is `editing.selectedCells` (already computed from
  `selectionAnchor`/`selectionActive` via `getRangeCells`). `getCellBounds`
  (already exported from `utils.ts:443`) converts a cell-id set to
  `{minRow, maxRow, minCol, maxCol}` — reused as-is for the new
  `TableRegion` bounds.

## 3. What I'm building

### a. `sheets/editor/structuralShift.ts` (new, pure, no React)
- `shiftedId(id, axis, op, index): string | null` — the unified per-cell id
  shift (insert: `>= index` shifts +1; delete: `=== index` → `null` (dropped),
  `> index` shifts -1).
- `shiftCellMap(cells, axis, op, index): Map<string, CellProps>` — 3-pass:
  1. Shift every cell to `shiftedId(...)`, dropping cells that map to `null`.
  2. For every merge anchor (`rowSpan`/`colSpan` > 1) whose span (along the
     shifted axis) strictly contains `index` (`anchorMin < index <=
     anchorMin + span - 1`): grow (insert, `span + 1`) or shrink (delete,
     `span - 1`, clearing that axis's span field entirely if it drops to
     `<= 1`) instead of moving the anchor. Anchors with `index <= anchorMin`
     are deliberately *not* special-cased — they just ride along with the
     normal per-cell shift like any other cell (this matches the plan's
     literal spec: "the whole merge shifts like a normal cell"), including the
     edge case where a delete's index lands exactly on the anchor's own
     row/col and the anchor cell is dropped like any other cell would be.
  3. Fix up every member cell's `mergeAnchor` string to the anchor's
     post-shift id; if the anchor was dropped or no longer has any span > 1,
     clear the member's `mergeAnchor` (unmerge) instead of leaving a dangling
     reference.
- `shiftRect(bounds, axis, op, index): RectBounds | null` — shared
  expand/shift/shrink rectangle logic for both CF ranges and table regions:
  insert before start → whole rect shifts; insert inside (`min < index <=
  max`) → grows by 1; insert after end → no change. Delete before start →
  shifts; delete inside (`min <= index <= max`) → shrinks by 1, returning
  `null` if that collapses `max < min` (caller drops the rule/region);
  delete after end → no change.
- `shiftIndexMap(map, op, index)` — for `colWidths`/`rowHeights` (0-based
  keys); converts the 1-based `index` to the 0-based key space internally
  (`key >= index - 1` shifts for insert; `key === index - 1` dropped, `key >
  index - 1` shifts for delete).
- CF range parse/serialize (`"A1:B10"` ⇄ `RectBounds`) + `shiftCFRules(rules,
  axis, op, index): CFRule[]` built on `shiftRect`, dropping any rule whose
  range collapses.
- `computeStructuralShift(input): output` — the single orchestrator:
  runs `shiftCellMap` first, then for every `TableRegion` whose bounds survive
  `shiftRect`, recomputes that region's full patch set via the existing
  `computeTableStylePatches` (looked up from `TABLE_STYLES` by `styleId`) and
  merges those patches into the *same* returned cell map — this is what
  satisfies "one atomic undo step covers cell shift + table recoloring."
  Regions that collapse are dropped. Also shifts `colWidths`/`rowHeights` (via
  `shiftIndexMap`, only on the matching axis) and `conditionalFormats` (via
  `shiftCFRules`). Returns `{ cells, colWidths, rowHeights,
  conditionalFormats, tableRegions }`.

### b. `sheets/editor/types.ts`
- Add `TableRegion = { id: string; styleId: string; minR: number; maxR: number;
  minC: number; maxC: number }` (1-based, matching `mergeCells`'s convention).
- Add `tables?: TableRegion[]` to `SheetData`.

### c. `sheets/editor/hooks/useTableRegions.ts` (new)
- Copies `useConditionalFormatting.ts`'s shape exactly: `sheetsTableRegionsRef`
  (per-sheet array), `tableRegions` state + ref for the active sheet,
  `flushActiveTableRegions`, `switchSheetTableRegions`, `updateTableRegions`.
- Adds `registerRegion(region: TableRegion)`: drops any existing region whose
  bounds overlap the new one, then appends it (simple replace-on-overlap,
  matches the plan's "reasonable judgment, don't over-engineer" instruction).
- Inherits the same known desync-on-sheet-delete/duplicate/reorder limitation
  as CF/charts — not fixed here, matching the existing pattern exactly (no
  flush/switch calls wired into `deleteSheet`/`duplicateSheet`/`moveSheet`,
  same as CF today).

### d. `usePersistence.ts`
- New optional params mirroring the CF ones: `sheetsTableRegionsRef`,
  `flushActiveTableRegions`, `setTableRegions`.
- `serialize()`: add `tables: sheetTables.length > 0 ? sheetTables : undefined`
  alongside `conditionalFormats` (~line 160).
- `load()`: restore `sheetsTableRegionsRef.current` from `rawSheets[i].tables
  ?? []` the same way as the CF restore block (~439-446), preserving any
  regions added on sheets created during an in-flight load.

### e. `SheetEditor.tsx`
- Instantiate `useTableRegions` alongside `charts`/`cf` (no feature flag —
  policy is no new flags for new work, and the plan explicitly says "no
  feature flags").
- Add `tableRegions.flushActiveTableRegions()` / `switchSheetTableRegions(idx)`
  calls at the same two call sites as `cf.*` (`onSwitchSheet`, `onAddSheet` in
  the `SheetTabBar` props, `SheetEditor.tsx:1853-1886`) — matching the
  existing pattern (and its existing gap) exactly.
- Pass `sheetsTableRegionsRef`/`flushActiveTableRegions`/`setTableRegions`
  into `usePersistence`.
- Add one shared callback, e.g.:
  ```ts
  const runStructuralShift = useCallback((axis: 'row'|'col', op: 'insert'|'delete', index: number) => {
      tableRegions.flushActiveTableRegions?.(); // no-op safety; state is already current via ref
      setData(prev => {
          history.pushToUndo(new Map(prev));
          const result = computeStructuralShift({
              cells: prev,
              colWidths: colWidthsRef.current,
              rowHeights: rowHeightsRef.current,
              conditionalFormats: cf.conditionalFormatsRef.current,
              tableRegions: tableRegions.tableRegionsRef.current,
              axis, op, index,
          });
          setColWidths(result.colWidths);
          setRowHeights(result.rowHeights);
          cf.updateConditionalFormats(result.conditionalFormats);
          tableRegions.updateTableRegions(result.tableRegions);
          return result.cells;
      });
      dirtyRef.current = true;
  }, [setData, history, cf, tableRegions, setColWidths, setRowHeights, dirtyRef]);
  ```
  (Calling the other setters from inside the `setData` updater is the same
  pattern already used elsewhere in this file for cross-state coordination;
  since `colWidths`/`rowHeights`/CF are not part of the undo entry, only the
  returned cell map matters for undo correctness.)
- Replace each of the 12 handler bodies with: parse the anchor
  (`contextMenu.cellId` or `headerContextMenu.index`) → compute the same
  `index` value the handler computes today → call
  `runStructuralShift(axis, op, index)`. No change to each handler's
  signature, guard clauses, or how it's wired into the context menus.
- Wire a new `onRegisterTableRegion` callback into `StyleToolbar`, built from
  `getCellBounds` (already in `utils.ts`) + `tableRegions.registerRegion`.

### f. `StyleToolbar.tsx`
- Add `onRegisterTableRegion?: (style: TableStyle, cells: Set<string>) => void`
  prop; call it alongside the existing `onApplyStyleMap(...)` call in the
  gallery's `onSelect` (`StyleToolbar.tsx:419-427`), passing the same `style`
  and `selectedCells` already in scope. No visual/UI change.

## 4. Risks / edge cases

- Deleting a row/col that is exactly a merge anchor's own row/col: per spec,
  intentionally falls back to "normal cell" treatment (the anchor is dropped
  like any other cell at that position) rather than being specially
  preserved — documented above, not a bug.
- A table region shrunk to a single row or single column must still produce
  valid style patches (`computeTableStylePatches` already handles `maxR ===
  minR` etc. per its existing tests) and must not crash when the header or
  total row is the one deleted.
- CF rule collapse-to-empty must remove the rule, not emit an inverted range.
- `colWidths`/`rowHeights` 0-based vs. cell-id 1-based indexing is the most
  likely off-by-one bug source — covered explicitly by dedicated unit tests.
- Table-region `registerRegion`'s overlap-replace is intentionally simple;
  not attempting real region-merge semantics.

## 5. Explicitly out of scope (per user instruction)

Formula reference rewriting; chart position shifting; column-filter
shifting; the sheet-delete/duplicate/reorder per-sheet-array desync; a
general multi-field transactional undo system; any new feature flag;
`web/apps/web/src/app/(apps)/photos/editor/PhotoCanvas.tsx` (untouched).

## 6. Specialists needed

- `frontend-developer` — all of the above (`structuralShift.ts`, `types.ts`,
  `useTableRegions.ts`, `usePersistence.ts`, `SheetEditor.tsx`,
  `StyleToolbar.tsx`). No backend/Rust work. No visual/CSS work (no new UI
  surface — table-region registration is invisible bookkeeping).
- `test-writer` — unit tests for `structuralShift.ts` (the bulk of the
  coverage: table region reshaping on insert/delete on both axes, CF range
  shift/drop, colWidths/rowHeights key shift, merge anchor shift/grow/shrink),
  plus an integration-level test that one undo step reverts an insert
  including table recoloring.

## 7. Acceptance criteria

- Inserting/deleting a row or column in the middle of a styled table region
  leaves no unstyled gap; header row/column and total row positions and band
  parity are correct for the new shape.
- CF rule ranges shift/grow/shrink/drop correctly across insert/delete
  before/inside/after the range.
- `colWidths`/`rowHeights` numeric keys shift correctly (0-based, converted
  from the 1-based insertion index).
- Merge anchors: merges entirely before/after the edit keep correct
  `mergeAnchor` strings after the anchor's key moves; merges straddling the
  edit point grow/shrink `rowSpan`/`colSpan` instead of moving.
- `Ctrl+Z` undoes an insert (cell shift + table recoloring) in one step.
- `pnpm vitest run apps/web/src/__tests__/sheets`, type-check, and lint are
  clean on touched files (pre-existing unrelated failure in
  `autosaveEncryptionWarning.test.tsx` is not a new regression, not fixed
  here).
- Manual verification in the dev server per the checklist (Step 6).
