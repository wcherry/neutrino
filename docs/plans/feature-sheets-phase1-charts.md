# Plan: Neutrino Sheets Phase 1 Charting

## What is Changing and Why

Neutrino Sheets currently has no charting capability. Phase 1 adds the core charting infrastructure needed to render, create, edit, and persist charts within a spreadsheet — the 8 chart types that cover 80-90% of real-world usage.

## Feature Flag

**Flag name:** `feature.sheets.charts`
**Env var:** `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS`
**Default:** off

## Chart Types Implemented

- Column Chart
- Bar Chart
- Line Chart
- Area Chart
- Pie Chart
- Donut Chart
- Scatter Plot
- Combo Chart (line+column)

## Architecture Overview

### Chart Data Model (types.ts extension)

A `ChartDef` object stores all chart configuration and is persisted as part of the `SheetFile` JSON format alongside `cells`, `colWidths`, and `rowHeights`.

```typescript
type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'combo';

type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'hidden';

type ChartSeries = {
  name: string;       // series label (from header row/col)
  dataRange: string;  // e.g. "B2:B10"
  color?: string;
  chartType?: ChartType; // for combo charts, per-series override
};

type ChartDef = {
  id: string;         // uuid
  type: ChartType;
  dataRange: string;  // e.g. "A1:D10" — source range
  hasHeaders: boolean;
  seriesInRows: boolean; // true = each row is a series; false = each col
  categories: string[]; // auto-detected category labels
  series: ChartSeries[];
  // Position (pixel offsets from top-left of grid content area)
  x: number;
  y: number;
  w: number;
  h: number;
  // Formatting
  title: string;
  xAxisTitle: string;
  yAxisTitle: string;
  legendPosition: LegendPosition;
  showDataLabels: boolean;
  showGridlines: boolean;
  backgroundColor: string;
  plotAreaColor: string;
};
```

### Layers Affected

1. **types.ts** — add `ChartDef`, `ChartSeries`, `LegendPosition`, `ChartType`; extend `SheetData` with optional `charts?: ChartDef[]`
2. **usePersistence.ts** — serialize/deserialize `charts` array in each sheet's JSON
3. **useSheets.ts** — expose per-sheet charts state
4. **SheetEditor.tsx** — wire chart state, render `<ChartLayer>`, handle toolbar "Insert Chart" button
5. **New files:**
   - `charts/chartTypes.ts` — chart data model re-exports
   - `charts/chartUtils.ts` — range parsing, data extraction from cell map
   - `charts/ChartRenderer.tsx` — renders chart by type using Recharts
   - `charts/ChartCreationDialog.tsx` — modal wizard with live preview
   - `charts/ChartEditorPanel.tsx` — side panel for editing selected chart
   - `charts/ChartLayer.tsx` — absolutely positioned overlay holding all draggable/resizable chart frames
   - `charts/ChartFrame.tsx` — single chart wrapper with drag/resize handles
   - `charts/useCharts.ts` — state + actions for charts in active sheet
   - `charts/charts.module.css` — all chart UI styles

### Rendering Library

No charting library is currently installed. We will add **Recharts** (MIT licence, React-native, well-maintained, ~110 kB gzipped). It provides composable components for all 8 required chart types.

Install command: `pnpm add recharts` in `web/apps/web`

### Data Flow

1. User selects a range and clicks "Insert Chart" in the StyleToolbar
2. `ChartCreationDialog` opens with the selected range pre-filled
3. `chartUtils.ts` parses the range and extracts categories + series from the cell map
4. Live preview renders inside the dialog using `ChartRenderer`
5. On confirm, a new `ChartDef` is added to `useCharts` state
6. `ChartLayer` renders all charts for the active sheet as absolutely positioned elements over the grid
7. `ChartFrame` handles drag/resize via mouse event tracking (same pattern as `SlideCanvas.tsx`)
8. Cell changes propagate to charts: `useEffect` in `useCharts` watches the cell data map and re-parses chart data whenever data changes
9. On every chart change, `dirtyRef.current = true` triggers the 3-second autosave

### Persistence

`SheetData` gains an optional `charts` field. The `serialize()` function in `usePersistence` writes charts alongside cells. `load()` reads them back. Existing files without charts load fine (charts defaults to `[]`).

### Copy/Paste/Delete

- Delete key on selected chart calls `removeChart`
- Ctrl+C / Ctrl+V handled in `ChartFrame` selection context
- Chart copy creates a new chart with a fresh ID and offset position

## Known Risks and Edge Cases

- Recharts SSR: must be imported only in `'use client'` components; Next.js App Router is fine as all sheets editor files are already client components
- Large ranges: chart data extraction is capped at 1000 rows to avoid blocking the main thread
- Merged cells: when a range includes merged cells, the anchor cell value is used
- Dark mode: the grid cells intentionally stay white; chart backgrounds default to white (`#ffffff`) and use design tokens only for UI chrome around them
- Cross-sheet ranges: Phase 1 only supports single-sheet ranges for charts

## Acceptance Criteria

- [ ] All 8 chart types render correctly from real spreadsheet data
- [ ] Chart creation dialog opens from selected range, shows live preview
- [ ] Charts persist across save/reload
- [ ] Charts update when cell values in their source range change
- [ ] Charts are draggable and resizable within the grid area
- [ ] Chart editor panel allows editing title, axis labels, legend, data labels, gridlines, colors
- [ ] Delete key removes selected chart
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS=true` enables the feature; default off hides it
