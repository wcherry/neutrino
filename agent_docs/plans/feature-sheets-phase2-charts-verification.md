# Manual Verification: Sheets Phase 2 Charts

## Prerequisites

- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS=true` set in `.env.local`
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2=true` set in `.env.local`
- [ ] Dev server running (`pnpm dev` from `web/`)
- [ ] Log in and create a new spreadsheet

## Data Setup

Enter this data in a fresh sheet to use as the chart source (A1:E6):

```
        A         B        C        D        E
1  Month     Sales    Costs    Profit   Ratio
2  Jan       100      60       40       0.4
3  Feb       150      80       70       0.47
4  Mar       120      90       30       0.25
5  Apr       200      110      90       0.45
6  May       180      100      80       0.44
```

For candlestick, use a 4-column dataset (Open/High/Low/Close) in rows 8–13.

## Steps to Verify

### 1. New Chart Types in Insert Dialog

1. Click "Insert Chart" in the toolbar
2. Confirm all Phase 2 types appear in the type picker: Stacked Col, Stacked Bar, 100% Col, 100% Bar, Bubble, Histogram, Candlestick, Waterfall, Treemap, Sunburst
3. Expected: 18 total chart types shown (8 Phase 1 + 10 Phase 2)

### 2. Stacked Column

1. Set range A1:C6, click "Stacked Col"
2. Expected: Two series (Sales, Costs) stacked vertically, legend shows both

### 3. Stacked Bar

1. Same data, click "Stacked Bar"
2. Expected: Horizontal stacked bars

### 4. 100% Stacked Column

1. Same data, click "100% Col"
2. Expected: Y axis shows 0%–100%, each bar totals to 100%, labels show percentages

### 5. 100% Stacked Bar

1. Same data, click "100% Bar"
2. Expected: X axis shows 0%–100%

### 6. Bubble Chart

1. Set range B1:D6 (Sales, Costs, Profit), click "Bubble"
2. Expected: Scatter-style chart with variable-sized circles

### 7. Histogram

1. Set range B1:B6 (single column of values), click "Histogram"
2. Expected: Bar chart with frequency on Y axis, bin ranges on X axis

### 8. Candlestick

1. Enter OHLC data in rows 8–12 (4 columns), set range to those cells, click "Candlestick"
2. Expected: Green/red candles with wicks; if fewer than 4 columns, shows error message
3. Test error: use a 2-column range; expected: "Candlestick requires 4 data columns" message

### 9. Waterfall

1. Set range A1:B6, click "Waterfall"
2. Expected: Floating bars with a grey/green Total bar at the end; negative values shown in red

### 10. Treemap

1. Set range A1:B6, click "Treemap"
2. Expected: Proportional rectangles, each labelled with the category name and value

### 11. Sunburst

1. Set range A1:B6, click "Sunburst"
2. Expected: Donut-like ring of arc segments; labels appear for larger segments

### 12. Chart Editor Panel — Themes (Phase 2)

1. Insert any chart and click it to open the editor panel
2. Scroll to "Theme" section
3. Click "Dark" — expected: chart background turns dark, colors change to lighter palette
4. Click "Pastel" — expected: chart uses soft pastel colors
5. Click "Corporate" — expected: navy/grey professional palette
6. Click "Colorblind Safe" — expected: Wong 2011 palette applied
7. Click "Default" — expected: reverts to original Google palette

### 13. Y Axis Controls (Phase 2)

1. Insert a column chart with range A1:B6
2. Open editor panel, scroll to "Y Axis"
3. Set Min to 50 — expected: Y axis starts at 50
4. Set Max to 250 — expected: Y axis capped at 250
5. Check "Logarithmic scale" — expected: Y axis spacing becomes logarithmic
6. Check "Reverse axis" — expected: Y axis inverted (high values at bottom)
7. Set Number format to "Currency", symbol "$", decimal places 2 — expected: tick labels like "$100.00"
8. Set Number format to "Percentage" — expected: tick labels like "100%"
9. Clear Min/Max (blank) — expected: axis returns to auto range

### 14. Series Controls (Phase 2)

1. Insert a line chart with range A1:C6 (2 series)
2. Open editor panel, scroll to "Series"
3. Click the color swatch for "Sales" — change color to red — expected: that series turns red on the chart
4. Uncheck the visibility checkbox for "Costs" — expected: Costs series disappears from chart
5. Re-check — expected: series reappears
6. Change line thickness to 4 for a series — expected: that line is visibly thicker
7. Set Marker style to "None" — expected: dots disappear from line chart
8. Set Marker style to "Circle" — expected: dots return

### 15. Data Labels — Phase 2 Config

1. Insert a column chart
2. Open editor panel, scroll to "Data Labels"
3. Check "Show labels" — expected: values appear above each bar
4. Change "Label type" to "Percentage" — expected: labels show percentage values
5. Change "Label type" to "Custom", enter "★" — expected: all labels show "★"
6. Change position to "Center" — expected: labels move inside bars
7. Change font size to 14 — expected: label text is visibly larger
8. Uncheck "Show labels" — expected: all labels disappear

### 16. Phase 1 Backward Compatibility

1. Insert a standard Column chart (Phase 1)
2. Verify it still renders correctly with Phase 2 flags on
3. Open editor panel — all Phase 1 sections (Type, Data, Titles, Legend, Display, Colors) still present and functional
4. Change type to Line — expected: chart switches to line; markers visible

### Feature Flag Off Verification

1. Set `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2=false` (or remove the var) and restart dev server
2. Open insert dialog — expected: only 8 Phase 1 chart types shown
3. Open editor panel on an existing chart — expected: Themes, Y Axis, Series, Data Labels sections not shown
4. Phase 2 chart types (if already inserted) show "Phase 2 charts require the sheetsChartsPhase2 feature flag" placeholder

## Expected Results Summary

| Feature | With P2 flag on | With P2 flag off |
|---|---|---|
| Insert dialog type count | 18 | 8 |
| Theme section in panel | Visible | Hidden |
| Y Axis section in panel | Visible | Hidden |
| Series controls in panel | Visible | Hidden |
| Data Labels config in panel | Visible | Hidden |
| P2 chart types render | Correct chart | Fallback message |
| P1 charts | Unchanged | Unchanged |

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2` — no deployment needed. Existing Phase 1 charts are unaffected.
