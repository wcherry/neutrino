# Plan: Formula Bar Cell Pick (Point-and-Click Cell Selection)

## What and Why

When a user types a formula like `=SUM(` in the formula bar, clicking a cell or
click-dragging a range should insert the corresponding reference (e.g. `A1` or
`A1:D4`) into the formula at the cursor position.  This is standard spreadsheet
behaviour (Excel, Google Sheets) and is currently absent — clicking while the
formula bar is active just commits the current cell and activates the clicked one
instead of inserting a reference.

## Layers Affected

**Frontend only** — no backend or Rust changes needed.

| File | Change |
|---|---|
| `apps/web/src/app/(apps)/sheets/editor/hooks/useCellEditing.ts` | Add `formulaPickMode` state; new `handleFormulaPickMouseDown` and `handleFormulaPickMouseMove` handlers; helper `insertCellRef`; expose via return value |
| `apps/web/src/app/(apps)/sheets/editor/SheetEditor.tsx` | Pass `formulaPickMode` to `SheetGrid` and wire the new pick handlers; use pick handlers instead of `handleCellActivate` / `handleSelectionExtend` when pick mode is active |
| `apps/web/src/app/(apps)/sheets/editor/SheetGrid.tsx` | Accept `formulaPickMode` prop and optional `onFormulaPickMouseDown` / `onFormulaPickMouseMove` props; render a visual formula-pick overlay when `formulaPickMode` is `true`; conditionally route `onMouseDown` / `onMouseMove` to the pick handlers |
| `apps/web/src/app/(apps)/sheets/editor/page.module.css` | Add `.formulaPickOverlay` style (dashed green/purple border, distinct from the blue selection border) |

## Feature Flag

Flag name: `NEXT_PUBLIC_FEATURE_FORMULA_BAR_CELL_PICK`
Utility: `src/lib/featureFlags.ts` → `featureFlags.formulaBarCellPick`
Default: **off** (env var absent or not `"true"`)
Enable: set `NEXT_PUBLIC_FEATURE_FORMULA_BAR_CELL_PICK=true` in `.env.local`
Guard: the new pick-mode logic in `useCellEditing` and the new SheetGrid props are guarded by this flag.

## Design

### Formula Pick Mode State Machine

`formulaPickMode` is a boolean. It becomes `true` when:

1. The formula bar input is focused (via `onFocus`)
2. AND the current formula starts with `=`

It becomes `false` when:
- The formula bar input loses focus (via `onBlur`) back to any element that is
  NOT a grid cell — i.e. we check `relatedTarget` to avoid exiting on the
  mousedown that initiates the cell click.
- The user presses Enter or Escape in the formula bar.
- The formula is edited to no longer start with `=`.

### insertCellRef(ref: string)

Takes a cell reference string (e.g. `"A1"` or `"A1:D4"`).

1. Reads the cursor position from `formulaInputRef.current.selectionStart`.
2. Builds a new raw value by replacing the last partial reference at the cursor
   (if any) with `ref`.  Specifically: scan backwards from the cursor to find
   where the "current token" starts — any character that is `[A-Za-z0-9:]` is
   part of a potential reference.  Replace that token with `ref`.
3. Sets `currentCell.raw` and the data map entry accordingly.
4. Moves the cursor to after the inserted reference.
5. Keeps focus on the formula input.

### Pick-mode mouse handling in SheetGrid

When `formulaPickMode` is `true` and the user presses the mouse button on a cell:

- `e.preventDefault()` (prevents the input from losing focus)
- Start a drag: record the `mousedownCellId` as the anchor.
- Call `onFormulaPickMouseDown(cellId)` — this calls `insertCellRef(cellId)`.

When the user moves the mouse with the button held:

- Call `onFormulaPickMouseMove(currentCellId)` — this calls
  `insertCellRef(rangeAddress(anchor, currentCellId))`.

On `mouseUp`, the drag ends.

The grid renders a second overlay (`formulaPickOverlay`) in a distinct colour
(green dashed border) to show the range being picked, separate from the blue
selection overlay.

### Visual feedback in formula bar

While `formulaPickMode` is `true`, the formula bar input gets a subtle coloured
left border (matching the pick-overlay colour) to signal that the user is in
pick mode.

## Specialist Agents

| Agent | Task |
|---|---|
| `test-writer` | Unit tests for `insertCellRef` logic; component tests for `useCellEditing` pick-mode state transitions; integration test for the full click-to-insert flow |
| `frontend-developer` | Implement all code changes listed above |
| `ui-designer` | Add `.formulaPickOverlay` CSS and the formula bar pick-mode indicator style |

## Risks and Edge Cases

- Must not exit pick mode on the `mousedown` that starts the drag (focus leaves
  the input briefly); solved by using `onBlur` with `relatedTarget` check.
- If the formula is `=` (user just typed the equals sign), clicking any cell
  should replace the bare `=` with `=A1` — the "last token" scan handles this
  because there is no token after `=`, so we insert immediately after it.
- Pressing Tab or Enter should commit the formula and exit pick mode.
- Escape should revert the cell to its pre-edit value and exit pick mode (this
  already works via existing Escape handling — just need to exit pick mode too).
- The pick-mode flag must be off when no cell is being edited (formula bar empty
  or not starting with `=`).
- Column/row header clicks during pick mode should insert the full-column /
  full-row reference (out of scope for this PR — headers are kept unchanged).

## Acceptance Criteria

- [ ] Typing `=SUM(` then clicking A1 inserts `=SUM(A1` at the cursor
- [ ] Typing `=SUM(` then dragging A1→D4 inserts `=SUM(A1:D4` at the cursor
- [ ] Clicking while NOT in formula-starts-with-`=` mode activates the cell normally
- [ ] Focus remains in the formula bar input throughout pick mode
- [ ] The pick-range overlay is visually distinct from the normal selection overlay
- [ ] Pressing Enter commits the formula and exits pick mode
- [ ] Pressing Escape reverts and exits pick mode
- [ ] With the feature flag disabled, behaviour is unchanged (normal cell activation on click)
- [ ] Tests pass
