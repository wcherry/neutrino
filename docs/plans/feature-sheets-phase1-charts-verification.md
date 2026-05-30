# Manual Verification: Neutrino Sheets Phase 1 Charting

## Prerequisites

- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS=true` added to `.env.local`
- [ ] App running locally (`pnpm dev` in `web/`)
- [ ] A spreadsheet open with some numeric data — for example:
  ```
  A1: Product   B1: Jan   C1: Feb   D1: Mar
  A2: Apples    B2: 120   C2: 95    D2: 140
  A3: Oranges   B3: 80    C3: 110   D3: 90
  A4: Bananas   B4: 60    C4: 75    D4: 85
  ```

## Steps to Verify

### Chart Toolbar Button

1. Open a sheet. The Style Toolbar should have a bar chart icon at the right end.
2. Click it — the "Insert Chart" dialog opens.

### Chart Creation Dialog

1. Select cells A1:D4 before clicking the toolbar button — the range pre-fills.
2. In the dialog, "Has headers" and "Series in rows" checkboxes appear.
3. Verify the live preview updates as you:
   - Switch between all 8 chart types (Column, Bar, Line, Area, Pie, Donut, Scatter, Combo)
   - Change the data range input
   - Toggle "Has headers"
4. Click "Insert Chart" — a chart appears overlaid on the grid at a default position.
5. Click "Cancel" — dialog closes with no chart inserted.

### Chart Types

For each chart type, insert a chart and verify it renders:
- [ ] Column — vertical bars grouped by category
- [ ] Bar — horizontal bars
- [ ] Line — connected dots
- [ ] Area — filled area below line
- [ ] Pie — full circle with segments
- [ ] Donut — ring with hole
- [ ] Scatter — dot cloud (uses first 2 series as X/Y)
- [ ] Combo — first series as bars, rest as lines

### Chart Interaction

1. Click a chart — blue selection border appears, 8 resize handles visible.
2. Drag the chart body — chart moves.
3. Drag a corner handle — chart resizes.
4. Drag an edge handle — chart resizes in one axis.
5. Click outside the chart — deselects it (no blue border).
6. With chart selected, press Delete — chart is removed.

### Chart Editor Panel

1. Select a chart — the Chart Editor Panel opens in the right sidebar.
2. Verify all sections work:
   - **Type**: click a different chart type — preview updates immediately
   - **Data > Range**: change the range, press Enter or blur — chart updates
   - **Data > Has headers**: toggle — chart updates
   - **Data > Series in rows**: toggle — chart updates
   - **Titles**: type a chart title, x-axis title, y-axis title
   - **Legend**: click Top/Bottom/Left/Right/Hidden — legend moves/disappears
   - **Display**: toggle "Show data labels" — values appear on bars/slices
   - **Display**: toggle "Show gridlines" — gridlines appear/disappear
   - **Colors > Background**: click swatch, pick a color — chart background changes
   - **Colors > Plot area**: click swatch, pick a color — plot area changes
3. "Delete Chart" button removes the chart and closes the panel.
4. X button closes the panel (deselects chart).

### Data Binding (Live Updates)

1. Insert a chart for range A1:D4.
2. Change the value in B2 from 120 to 200.
3. Verify the chart updates immediately to reflect the new value.

### Copy/Paste Chart (via browser)

1. Select a chart.
2. Press Delete — chart is removed.
3. Undo is not required for Phase 1; verify chart is gone.

### Multiple Charts

1. Insert two charts from the same data range.
2. Verify both render independently and can be selected separately.
3. Selecting one does not affect the other.

### Multiple Sheets

1. Insert a chart on Sheet 1.
2. Switch to Sheet 2 — the chart is not visible (it belongs to Sheet 1).
3. Switch back to Sheet 1 — the chart reappears.

### Persistence

1. Insert a chart and configure it with a custom title.
2. Save manually (Ctrl/Cmd+S or hamburger menu > Save).
3. Close the browser tab and reopen the spreadsheet.
4. Verify the chart is still present with the same position, size, and title.

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS=true` from `.env.local`.
2. Restart dev server.
3. Verify:
   - Bar chart icon is absent from the Style Toolbar
   - No `ChartLayer` overlay renders
   - All other sheet functionality works normally
4. Re-enable the flag.

## Expected Results

- Charts appear as floating overlays above the grid, not inside cells.
- The chart area is always white (not affected by dark mode).
- Tooltips appear on hover over chart elements.
- The creation dialog is large enough to show a useful preview.
- The editor panel is narrow enough not to obscure the grid significantly.

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS` — no deployment needed. Existing spreadsheet files with saved charts will safely ignore the `charts` field when the flag is off.
