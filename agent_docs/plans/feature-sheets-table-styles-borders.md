# Plan: Table style border variants (no-border / horizontal-only) + Blank style

Branch: `feature/sheets-table-styles-borders` (off `main` @ `b0dbbb9`, confirmed PRs #54/#55/#56 merged)

## What is changing and why

The Table Styles gallery (`sheets/editor/styles/tableStyles.ts`) currently has 28
entries (14 hues x 2 layouts), all with a uniform thin border on every cell.
The user wants two new border treatments — **no borders** and **horizontal
lines only** — crossed with the full existing 14-hue x 2-layout matrix (14 x 2
x 3 = 84 styles), plus one hand-written **Blank** entry that clears all
formatting (84 + 1 = 85 total).

`CellStyle.borderStyle` is a single enum rendered as a uniform CSS `border`
shorthand — there's no way to express "top+bottom only, no left/right" today.
This requires adding a per-side border concept to `CellStyle` and `Cell.tsx`,
plus fixing a cross-contamination bug it would otherwise create between the
new per-side fields and the existing uniform border controls.

## Layers affected

- **Types**: `types.ts` — add `borderTop`/`borderRight`/`borderBottom`/`borderLeft` to `CellStyle`.
- **Frontend rendering**: `Cell.tsx` — per-side border rendering with legacy fallback.
- **Frontend logic**: `HamburgerMenu.tsx` (Borders submenu), `StyleToolbar.tsx` (border select) — explicitly clear the 4 side fields when a uniform border is chosen.
- **Data**: `styles/tableStyles.ts` — regenerate `TABLE_STYLES` as 84 generated + 1 hand-written Blank entry, each with a fully-explicit 5-key border patch.
- **Logic**: `styles/applyTableStyle.ts` — `computeTableStylePatches` must propagate the style's full border patch (not just `borderStyle`) to header/band/total-row patches.
- **Wiring**: `StyleToolbar.tsx`'s gallery `onSelect` — special-case Blank (flat `applyStyle` over selection + untrack overlapping `TableRegion`s) vs. the 84 regular styles (unchanged `computeTableStylePatches` + `applyStyleMap` + `registerRegion` flow).
- **Region tracking**: `hooks/useTableRegions.ts` — add a `removeOverlapping(bounds)` method (reusing the existing `regionsOverlap` helper) so Blank can untrack regions without registering a replacement.
- **Design/preview**: `components/TableStylePreviewSwatch.tsx` (+ `.module.css`) — render actual border patch per side instead of a fixed CSS border; distinct "Blank" preview.
- **Tests**: extend `tableStyles.test.ts`, `applyTableStyle.test.ts`, `TableStyleGalleryModal.test.tsx`; add `Cell.tsx` border-rendering tests and `StyleToolbar`/`HamburgerMenu` uniform-border-clears-sides tests; wiring test for Blank untracking a region.

## Specialists needed

- `frontend-developer`: `types.ts`, `Cell.tsx`, `HamburgerMenu.tsx`, `StyleToolbar.tsx`, `useTableRegions.ts`, `tableStyles.ts`, `applyTableStyle.ts` wiring, `SheetEditor.tsx` Blank-select handler.
- `ui-designer`: `TableStylePreviewSwatch.tsx` + its CSS module (border-per-side preview rendering, distinct Blank card visual).
- `test-writer`: unit/component tests listed above.

No backend/Rust involved — this is a pure frontend feature.

## Design decisions

**Border-patch shape** (3 variants, each explicit on all 5 `CellStyle` border keys):
```ts
type BorderPatch = Pick<CellStyle, 'borderStyle' | 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft'>;

const UNIFORM: BorderPatch = { borderStyle: 'thin', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined };
const NO_BORDER: BorderPatch = { borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' };
const HORIZONTAL_ONLY: BorderPatch = { borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none' };
```

**`TableStyle` type**: replace `borderStyle: CellStyle['borderStyle']` with `border: BorderPatch`. `computeTableStylePatches` spreads `style.border` into every patch (header look and body patch alike) instead of just `borderStyle`.

**Naming**: uniform variant keeps existing `"{Hue} Banded"` / `"{Hue} Header & Totals"` names (zero visual/behavioral change, regression-tested byte-for-byte against current 28). New variants: `"{Hue} Banded — No Border"` / `"{Hue} Banded — Horizontal Lines"` and Header & Totals equivalents.

**Blank style**: discriminated union —
```ts
type TableStyle = RegularTableStyle | BlankTableStyle;
type BlankTableStyle = { id: 'blank'; name: 'Blank'; kind: 'blank'; clearPatch: Partial<CellStyle> };
type RegularTableStyle = { id: string; name: string; kind: 'regular'; header: ...; bandColorA; bandColorB; border: BorderPatch; headerRow; headerColumn; totalRow };
```
`clearPatch` is exactly the same key list as `HamburgerMenu.tsx`'s "Clear formatting" action, plus the 4 new side fields undefined.

**Wiring**: in `StyleToolbar.tsx`'s gallery `onSelect`, branch on `style.kind`:
- `'blank'` → call `editing.applyStyle(style.clearPatch)` directly (operates on current selection already) + call a new `onClearTableRegion?.(selectedCells)` prop that SheetEditor wires to `tableRegions.removeOverlapping(bounds)`.
- `'regular'` → unchanged flow.

**Cell.tsx rendering rule**: if any of `borderTop/Right/Bottom/Left` is defined (`!== undefined`) on `cs`, render each side independently (undefined sibling => no border for that side, not legacy fallback). Otherwise fall back to the existing uniform `borderStyle` block unchanged.

**Uniform-border-sets-must-clear-sides fix**: every place that sets `borderStyle` from a fixed uniform-border control (not table styles) must also explicitly spread `{ borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined }` in the same `onStyleChange`/action call. Two call sites: `HamburgerMenu.tsx` Borders submenu (4 actions), `StyleToolbar.tsx` border `<select onChange>`.

## Risks / edge cases

- Regression risk on the original 28 styles' exact output — must verify byte-identical patches (deep-equal) pre/post change, not just visual similarity.
- `computeTableStylePatches`'s `HEADER_PATCH`/body patch construction currently only sets `borderStyle`; must spread all 5 keys consistently on **every** patch branch (header look, band patch) or some cells in a horizontal-only style could end up with stale vertical borders from a previously-applied uniform style.
- Preview swatch currently draws a fixed CSS border via `.module.css` `.cell { border: 1px solid ... }` — must be overridden with inline per-side styles from the real patch so no-border/horizontal previews aren't misleading.
- `TableRegion` removal for Blank must use the same bounds computation (`getCellBounds`) as `registerRegion` uses, so overlap detection is consistent.
- Must not regress `structuralShift.ts`/`useTableRegions.test.ts` behavior — `removeOverlapping` is additive, doesn't change `registerRegion`'s existing overlap-drop-and-append semantics.
- Do not touch `PhotoCanvas.tsx` (unrelated, currently modified on a different branch — out of scope, explicitly excluded per user constraint).

## Acceptance criteria

- `TABLE_STYLES` has exactly 85 entries (84 regular + 1 Blank).
- The 28 original uniform-border entries produce byte-identical `computeTableStylePatches` output to pre-change behavior.
- Each of the 3 border-patch shapes produces the correct explicit 5-key patch, applied consistently to header/band/total-row cells.
- `Cell.tsx` renders legacy uniform border when no side fields are set; renders exact independent sides (including `'none'` sides rendering as no border) when any side field is set; horizontal-only renders top+bottom, not left/right.
- Uniform border controls (`HamburgerMenu`, `StyleToolbar`) clear all 4 side fields so switching directional→uniform actually changes rendering.
- Applying "Blank" clears every key `HamburgerMenu`'s Clear-formatting clears (plus the 4 side fields) over the current selection, and removes/untracks any overlapping `TableRegion` so a later structural-shift insert doesn't resurrect old banding.
- `TableStylePreviewSwatch` visibly reflects no-border (no grid lines) / horizontal-only (top+bottom lines, no verticals) / uniform (all lines); Blank has a visually distinct "no formatting" preview.
- All touched/new files pass `pnpm vitest run apps/web/src/__tests__/sheets`, type-check, and lint, with no *new* failures beyond the known pre-existing `autosaveEncryptionWarning.test.tsx` failure.
- Manual verification against local dev server per the checklist in the verification doc.
