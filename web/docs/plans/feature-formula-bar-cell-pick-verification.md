# Manual Verification: Formula Bar Cell Pick

## Prerequisites

- [ ] Feature flag `NEXT_PUBLIC_FEATURE_FORMULA_BAR_CELL_PICK=true` set in `.env.local`
- [ ] Dev server running (`pnpm dev` in `apps/web`)
- [ ] A sheet open in the editor

## Steps to Verify

### Happy Path — Single Cell Click

1. Click any cell (e.g. C3) to make it the active cell.
2. In the formula bar, type `=SUM(`.
3. Observe the formula bar input gains a green left border and the hint text
   "Click a cell or drag a range to insert reference" appears at the right.
4. Click cell A1 in the grid.
5. Verify the formula bar now shows `=SUM(A1` and the cursor is positioned
   after `A1`.
6. The formula bar should still have focus (you can keep typing).

### Happy Path — Range Drag

1. Repeat steps 1–3 above.
2. Press and hold the mouse button on cell A1.
3. While holding, drag to D4.
4. Verify the formula bar updates in real time as you drag:
   - Over A1 alone: shows `=SUM(A1`
   - Over A1:B2: shows `=SUM(A1:B2`
   - Over A1:D4: shows `=SUM(A1:D4`
5. Release the mouse. The formula bar should show `=SUM(A1:D4` with focus
   retained.

### Green Pick Overlay

1. In pick mode (formula starts with `=`), drag across a range.
2. Verify a green dashed overlay appears over the cells being picked.
3. Verify the blue selection overlay does NOT appear for the pick range.

### Multiple Argument Formula

1. Click a cell, type `=SUM(`.
2. Click A1 — formula becomes `=SUM(A1`.
3. Type `,`.
4. Click B2 — formula becomes `=SUM(A1,B2`.
5. Type `)` and press Enter.
6. Verify the cell shows the correct sum result.

### Commit with Enter

1. Type `=A1+B1` in the formula bar.
2. Press Enter.
3. Verify pick mode indicator disappears and the next cell is activated
   (row below).

### Cancel with Escape

1. Click a cell.  Note its current value.
2. Type `=SUM(`.
3. Click A1 — formula changes.
4. Press Escape.
5. Verify the cell reverts to its original value and pick mode exits.

### Non-Formula Input (No Pick Mode)

1. Click a cell.
2. Type `hello` (no leading `=`) in the formula bar.
3. Verify the green left border does NOT appear (pick mode is off).
4. Click another cell — it should be activated normally (not insert a ref).

### Edge Cases

1. Type just `=` in the formula bar.
2. Click A1.
3. Verify the formula bar shows `=A1` (bare `=` is replaced, not duplicated).

### Clicking Outside the Grid Exits Pick Mode

1. Enter pick mode (type `=SUM(`).
2. Click the toolbar (bold button, etc.).
3. Verify the green pick indicator disappears.
4. Clicking cells now activates them normally.

## Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_FORMULA_BAR_CELL_PICK=true` from `.env.local`
   (or set it to `false`).
2. Restart dev server.
3. Type `=SUM(` in the formula bar.
4. Click a cell — it should be activated normally (no reference inserted).
5. Verify no green left border or hint text appears.

## Expected Results Summary

| Action | Expected |
|---|---|
| Type `=SUM(`, click A1 | Formula bar shows `=SUM(A1`, focus retained |
| Type `=SUM(`, drag A1→D4 | Formula bar shows `=SUM(A1:D4`, green overlay visible |
| Type `=SUM(`, type `,`, click B2 | Formula bar shows `=SUM(A1,B2` |
| Press Enter | Formula committed, pick mode off |
| Press Escape | Cell reverted, pick mode off |
| Type non-formula, click cell | Cell activated normally |
| Flag off — type `=SUM(`, click cell | Cell activated normally (old behaviour) |

## Rollback

Disable `NEXT_PUBLIC_FEATURE_FORMULA_BAR_CELL_PICK` — no deployment needed.
The feature is entirely client-side and gated behind the env var.
