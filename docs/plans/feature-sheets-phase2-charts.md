# Plan: Neutrino Sheets Phase 2 Charting

## What is Changing and Why

Phase 1 delivered the 8 core chart types and basic formatting. Phase 2 adds professional-grade charting: more chart types, richer axis controls, per-series formatting, advanced data labels, and built-in themes. This brings Neutrino Sheets closer to Excel/Google Sheets feature parity for power users.

## Feature Flag

**Flag name:** `feature.sheets.chartsPhase2`
**Env var:** `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2`
**Default:** off

Phase 2 builds on Phase 1 (`NEXT_PUBLIC_FEATURE_SHEETS_CHARTS`). Phase 2 features are gated behind both flags — Phase 1 must also be enabled.

## Additional Chart Types

| Type | Recharts Component | Notes |
|---|---|---|
| Stacked Column | `BarChart` + `Bar stackId` | Vertical stacked bars |
| Stacked Bar | `BarChart layout="vertical"` + `stackId` | Horizontal stacked |
| 100% Stacked Column | Same as stacked, use `type="percent"` via data normalization | Calculate percentages |
| 100% Stacked Bar | Same as above, horizontal | |
| Bubble Chart | `ScatterChart` + `ZAxis` with bubble size | 3rd column as Z |
| Histogram | `BarChart` with bins computed from raw data | Bin computation in chartUtils |
| Candlestick | Custom SVG via `ComposedChart` + `Bar` | OHLC data: Open/High/Low/Close |
| Waterfall | `ComposedChart` + invisible bars + visible bars | Running total calculation |
| Treemap | `Treemap` from Recharts | Single-level rectangles |
| Sunburst | Custom D3/SVG or Recharts Sunburst | Hierarchical pie slices |

**Note on Candlestick and Sunburst:** Recharts v3.8 does not have a native Candlestick or Sunburst component. Candlestick will be implemented using ComposedChart + custom shapes. Sunburst will use a custom SVG renderer.

## Axis Controls (extended ChartDef fields)

```typescript
type AxisConfig = {
  min?: number;          // manual min (undefined = auto)
  max?: number;          // manual max
  tickInterval?: number; // custom tick spacing
  logScale?: boolean;    // logarithmic scale
  reversed?: boolean;    // reverse axis direction
  dateAxis?: boolean;    // treat values as dates
  numberFormat?: 'default' | 'currency' | 'percentage' | 'number';
  currencySymbol?: string; // e.g. "$" when numberFormat='currency'
  decimalPlaces?: number;  // precision for number/currency/percentage
};
```

Added to `ChartDef`:
- `xAxis?: AxisConfig`
- `yAxis?: AxisConfig`
- `y2Axis?: AxisConfig` (secondary Y axis)

## Series Controls (extended ChartSeries fields)

```typescript
type ChartSeries = {
  // existing
  name: string;
  dataRange: string;
  color?: string;
  chartType?: ChartType;
  // new in Phase 2
  lineThickness?: number;      // stroke width for line/area (default: 2)
  markerStyle?: 'circle' | 'square' | 'triangle' | 'diamond' | 'none';
  markerSize?: number;         // radius (default: 3)
  visible?: boolean;           // false = skip rendering
  yAxisId?: 'left' | 'right';  // secondary Y axis assignment
};
```

## Data Labels (extended ChartDef fields)

```typescript
type DataLabelConfig = {
  show: boolean;
  type: 'value' | 'percentage' | 'category' | 'custom';
  customText?: string;
  position: 'top' | 'bottom' | 'inside' | 'outside' | 'center';
  fontSize?: number;
  color?: string;
};
```

Added to `ChartDef`:
- `dataLabel?: DataLabelConfig`

The existing `showDataLabels: boolean` is kept for backward compatibility and defaults to `{ show: true, type: 'value', position: 'top' }` when true.

## Chart Styles / Themes

Built-in themes stored as a record in chartThemes.ts:

```typescript
type ChartTheme = {
  name: string;
  colors: string[];           // color palette override
  backgroundColor: string;
  plotAreaColor: string;
  gridlineColor: string;
  fontFamily?: string;
  axisColor?: string;
};
```

Themes:
- `default` — current Google-palette colors, white background
- `dark` — dark background (#1e1e2e), muted palette
- `pastel` — soft pastel colors
- `corporate` — navy/grey professional palette
- `colorblind` — accessible palette (Wong 2011)

Added to `ChartDef`:
- `theme?: string` — theme name (defaults to 'default')
- `savedStyle?: Partial<ChartTheme>` — saved custom overrides

## Layers Affected

1. **chartTypes.ts** — extend `ChartType`, `ChartSeries`, `ChartDef` with Phase 2 fields; add `AxisConfig`, `DataLabelConfig`, `ChartTheme` types
2. **chartUtils.ts** — add histogram bin computation, waterfall running totals, 100% stacked normalization, `applyTheme()` helper
3. **chartThemes.ts** — new file with built-in themes
4. **ChartRenderer.tsx** — add rendering for 9 new chart types + honor all new config
5. **ChartEditorPanel.tsx** — new sections: Axis, Series, Data Labels, Style
6. **ChartCreationDialog.tsx** — add new chart types to picker
7. **featureFlags.ts** — add `sheetsChartsPhase2` flag

## Known Risks and Edge Cases

- Treemap/Sunburst require Recharts' `Treemap` and a custom SVG for sunburst; the data model must be hierarchical (first column as group, second as value)
- Candlestick: requires exactly 4 series (Open, High, Low, Close); will show an error state if column count is wrong
- Logarithmic scale: values <= 0 will be clamped to 0.001 with a warning
- Secondary Y axis: only applicable to combo/line charts; other types will ignore `y2Axis`
- 100% stacked normalization: computed fresh on each render from raw data, not stored
- Custom number formatting: deferred to a `formatter` function that wraps Recharts tick formatters
- Backward compatibility: all new ChartDef fields are optional — existing Phase 1 charts load and render unchanged

## Acceptance Criteria

- [ ] All 9 new chart types render from real spreadsheet data
- [ ] New chart types appear in the creation dialog and editor type picker
- [ ] Axis controls (min/max, log scale, reverse, number format) apply to rendered chart
- [ ] Per-series color, line thickness, marker style, visibility, and secondary Y-axis work
- [ ] Data label config (type, position, custom text) works for all applicable chart types
- [ ] Built-in themes change the chart palette and background colors
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2` gates all Phase 2 UI additions
- [ ] Phase 1 charts continue working with Phase 2 enabled
- [ ] Unit tests cover: new chart type rendering logic, axis config helpers, histogram binning, waterfall calculations, theme application
