# Manual Verification: Sheets Arrow Key Navigation + Dark Mode Contrast

## Prerequisites
- Run `pnpm dev` and open a sheet in the editor: `/sheets/editor?id=<any-id>`
- To test dark mode: open Settings and enable dark theme, or set `data-theme="dark"` on the `<html>` element via DevTools.

## Feature 1 — Arrow key cell navigation

### Happy Path
1. Click on any cell (e.g. B3) to select it. The cell should highlight with a blue border.
2. Press ArrowDown — selection should move to B4.
3. Press ArrowRight — selection should move to C4.
4. Press ArrowUp — selection should move to C3.
5. Press ArrowLeft — selection should move back to B3.
6. Click a cell near the right edge of the visible viewport, then press ArrowRight several times. The grid should scroll to keep the selected cell in view.

### Guard: No movement while editing
1. Click on any cell to select it.
2. Start typing a formula (e.g. `=SUM(`) — the formula bar input receives focus.
3. Press ArrowLeft or ArrowRight inside the formula bar — the text cursor within the formula should move, but the cell selection must NOT change.
4. Press Escape to cancel editing.

### Guard: Modifier keys
1. Select a cell.
2. Press Ctrl+ArrowRight (or Cmd+ArrowRight on Mac) — no cell navigation should occur (this is a browser/OS shortcut for word jump).
3. Press Alt+ArrowDown — no cell navigation should occur.

### Boundary clamping
1. Click cell A1.
2. Press ArrowUp — selection stays at A1 (does not wrap or go negative).
3. Press ArrowLeft — selection stays at A1.
4. Navigate to a high row number (e.g. type A65536 in the Name Box or navigate there).
5. Press ArrowDown — selection stays at A65536.

## Feature 2 — Dark mode contrast

### Sheet tabs (dark mode)
1. Enable dark theme.
2. Open any sheet in the editor.
3. Observe the tab bar at the bottom:
   - The tab bar background should be a dark blue-grey (not the light `rgb(240,240,245)` from light mode).
   - The **active** tab should be clearly lighter/brighter than the inactive tabs — you should immediately tell which sheet is selected.
   - Inactive tabs should have readable text against the dark background.
4. Hover over an inactive tab — it should show a slightly lighter hover state.
5. Switch to a different sheet by clicking an inactive tab — the active/inactive states should swap visually.

### Selected cell highlight (dark mode)
1. Enable dark theme.
2. Click on any cell.
3. The selected cell should show a visible blue tint (slightly more saturated than light mode due to the dark surrounding).
4. The selection border overlay (blue rectangle around the selection) should be clearly visible.
5. Text inside the selected cell must remain readable — white/black text on a white cell background with a blue tint.
6. If the cell has a user-set fill colour (set via the background colour picker), that fill colour must be preserved in dark mode — only the selection highlight changes.

### Feature flag off (N/A)
These features are polish items with no feature flag. Both are always enabled.

## Rollback
To revert: revert the CSS changes in `page.module.css` and the keyboard handler in `SheetEditor.tsx`.
