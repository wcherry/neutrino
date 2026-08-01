# Plan: Neutrino Sheets Phase 5 Charting — Presentation Features

## What is Changing and Why

Phase 5 adds "Presentation Features" on top of the Phase 1 charting infrastructure that is already merged on `main`. Phase 2 is on a separate branch and is not yet merged, so Phase 5 branches from `main` and is designed to be independent.

The goal is to allow users to annotate charts for reporting, export charts as images/documents, and optionally animate charts for presentations.

## Feature Flag

**Flag name:** `sheetsChartsPhase5`
**Env var:** `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE5`
**Default:** off
**Prerequisite:** `NEXT_PUBLIC_FEATURE_SHEETS_CHARTS=true` (Phase 1 charts must be enabled)

## Scope

### 1. Annotation
Annotations are SVG overlay elements drawn on top of a chart. They are stored in `ChartDef.annotations[]` and rendered by `ChartAnnotationLayer` inside `ChartFrame`.

Supported annotation types:
- **Callout** — speech-bubble shape pointing to a data area, with editable text
- **Note** — text box with optional background color
- **Arrow** — straight arrow between two points on the chart
- **Shape** — rectangle, ellipse, or line
- **Text overlay** — free-floating text with font/size/color controls

Annotation data model:
```typescript
type AnnotationType = 'callout' | 'note' | 'arrow' | 'shape' | 'text';
type ShapeKind = 'rect' | 'ellipse' | 'line';

type ChartAnnotation = {
  id: string;
  type: AnnotationType;
  // Position/size within the chart frame (0–1 normalised, so annotations
  // scale with the chart when the chart is resized)
  x: number;         // left edge, 0–1 fraction of chart width
  y: number;         // top edge, 0–1 fraction of chart height
  w: number;         // width
  h: number;         // height
  text?: string;
  fontSize?: number;
  fontColor?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  // Arrow-specific
  x2?: number;       // arrow end x
  y2?: number;       // arrow end y
  // Shape-specific
  shapeKind?: ShapeKind;
};
```

### 2. Export
Client-side export using the DOM/SVG. Three strategies:

| Format  | Approach |
|---------|----------|
| PNG     | `canvas.toDataURL('image/png')` via native browser API after drawing the chart SVG onto a canvas |
| SVG     | Extract the SVG from the chart DOM node via `XMLSerializer` |
| PDF     | Print the chart via `window.print()` using an isolated print-only `<div>` |
| Clipboard | Copy the PNG blob to the Clipboard API |
| Print   | `window.print()` with `@media print` CSS that isolates the chart |

No new npm packages are required. The native browser APIs (`canvas`, `Blob`, `ClipboardItem`, `window.print`) are used. This avoids adding large third-party libraries like jsPDF or html2canvas.

### 3. Animation
CSS-only animation using `@keyframes` in a dedicated module. No external animation library is needed.

Animation modes (mutually exclusive):
- **Reveal series** — each series/bar fades and slides in sequentially on mount
- **Highlight data points** — selected data points pulse with a glow effect
- **Presentation transitions** — the whole chart fades/scales in on first render

Animations are controlled by a `ChartDef.animation` field and are only active when Phase 5 is enabled.

## Layers Affected

| Layer | File(s) |
|-------|---------|
| Types | `chartTypes.ts` — add `ChartAnnotation`, `ChartAnimationConfig` to `ChartDef` |
| Annotation UI | `charts/ChartAnnotationLayer.tsx` — SVG overlay with draggable annotations |
| Annotation editor | `ChartEditorPanel.tsx` — Phase 5 section: add/remove annotations, edit text/color |
| Export | `charts/chartExport.ts` — export utilities (PNG, SVG, PDF, clipboard, print) |
| Export UI | `ChartEditorPanel.tsx` — Phase 5 section: Export buttons |
| Animation CSS | `charts/chartAnimation.module.css` — CSS keyframes for all animation modes |
| Animation types | `chartTypes.ts` — `ChartAnimationConfig` |
| ChartFrame | `ChartFrame.tsx` — compose `ChartAnnotationLayer`, pass animation class |
| Feature flag | `featureFlags.ts` — add `sheetsChartsPhase5` |
| Tests | `src/__tests__/sheets/chartPhase5.test.ts` |

## Architecture Notes

### Annotation positioning
Annotations use normalised (0–1) coordinates within the chart frame. On render, these are multiplied by the actual pixel width/height of the `ChartFrame`. This means annotations stay in the correct relative position when the chart is resized.

### Export implementation
- PNG: create an `<img>` from SVG data URL, draw it on a `<canvas>`, download the canvas as PNG.
- SVG: serialise the entire `ChartFrame` DOM to SVG using `XMLSerializer`, encode as data URL, download.
- PDF: use `@media print` CSS to hide everything except the selected chart frame, then call `window.print()`.
- Clipboard: write a PNG `Blob` to `navigator.clipboard.write([new ClipboardItem(...)])`.

The export functions receive the chart DOM element as a `RefObject<HTMLDivElement>` passed from `ChartFrame` via a new `frameRef` prop.

### Animation
The animation configuration is stored in `ChartDef.animation` (type `ChartAnimationConfig`). When Phase 5 is enabled, `ChartFrame` applies a CSS animation class to the chart content div based on the animation mode. `ChartRenderer` passes `animationMode` to individual series/bar components via a CSS-variables-based approach.

## Known Risks and Edge Cases

- **SVG export** of Recharts SVG may not capture text rendered via `foreignObject` in some browsers; fallback to PNG in those cases.
- **Clipboard API** requires `clipboard-write` permission; show a friendly error if denied.
- **Print** uses `window.print()` which is synchronous and cannot be easily tested; covered by a unit test that mocks `window.print`.
- **Annotations on resize** — normalised coordinates prevent drift but annotations at the very edge may go out of bounds if the chart is resized smaller; clamped to [0.02, 0.98].
- **Phase 2 co-existence** — Phase 5 types are purely additive. If Phase 2 is later merged its fields sit alongside Phase 5 fields in `ChartDef` without conflict.

## Acceptance Criteria

- [ ] `featureFlags.sheetsChartsPhase5` gates all Phase 5 UI (annotations, export panel, animation panel); defaults to off
- [ ] Callout, Note, Arrow, Shape, Text overlay annotations can be added, moved, and deleted from a selected chart
- [ ] Annotation text is editable inline by double-clicking the annotation
- [ ] Chart can be downloaded as PNG, SVG, and PDF
- [ ] Chart can be copied to clipboard as an image
- [ ] Print button triggers browser print with only the chart visible
- [ ] Animations (reveal-series, highlight-points, presentation-transition) apply when selected
- [ ] All annotations persist in `ChartDef` JSON alongside chart data
- [ ] Unit tests cover annotation model helpers and export utilities
- [ ] Existing Phase 1 tests continue to pass
