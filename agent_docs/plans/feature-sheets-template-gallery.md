# Sheets: "New" flow gets a Blank / Template choice + 20-template gallery

Branch: `feature/sheets-template-gallery`

## What is changing and why

Today, Sheets' hamburger-menu "New" action opens a single dialog that only asks
for a filename before creating a blank sheet (`ExportDialogs.tsx`,
`hamburgerDialog === 'new'`). We are extending this into a two-step flow:

1. **Blank vs. Template** chooser.
2. If **Template**: a gallery of 20 starter spreadsheet templates, each with a
   small live mini-grid preview rendered from real header/sample-row data
   (not a static image), a name field defaulting to the template's name, then
   creation + navigation into the editor with the template's content seeded.

This mirrors the Diagrams app's recently-shipped starter-templates feature
(commit `d13eb87`), adapted to Sheets' own persistence architecture.

## Layers affected

- **Frontend only** (`web/apps/web/src/app/(apps)/sheets/...`). No backend
  changes — `sheetsApi.createSheet` already creates a blank sheet; we reuse it
  unmodified for both Blank and Template paths.
- No design-system additions — reusing `@neutrino/ui`'s `Modal` /
  `ModalHeader` / `ModalBody` (same primitives Diagrams' `TemplatePickerModal`
  uses) plus the existing custom dialog CSS classes already in
  `ExportDialogs.tsx` (`dialogOverlay`/`dialogBox`/etc.) for the two small
  text-style dialogs, to stay visually consistent with the other "New" /
  "Duplicate" dialogs in the same file.
- Tests: none requested for this task by the user (not using the TDD workflow
  here — this is a direct implementation request); will still run existing
  type-check/lint before finishing.

## Data model findings (Sheets)

- A sheet's cell data is `Map<string, CellProps>` per tab; `CellProps.raw` is
  the formula/user-typed string (e.g. `=SUM(B2:B5)`), `CellProps.value` is the
  pre-computed display value. Formulas are fully supported, including
  cross-sheet refs (`=Beta!C4`), via `computeCell`/`propagateDeps` in
  `formula.ts`.
- The **persisted-file shape** (`SheetFile` in `editor/types.ts`) —
  `{ sheets: [{ name, color?, cells: Record<string, SavedCell>, ... }] }` —
  is exactly the JSON usePersistence serializes to/from Drive. `usePersistence.ts`
  has two currently-private helpers, `buildRawSheetMap` (raw cells → `CellProps`
  map) and `evaluateSheetMap` (runs formulas with cross-sheet context to fill
  in `value`/`deps`/`dependents`). These are the exact primitives needed to
  turn a template's declarative `SheetFile` into live `CellProps` maps.
- `useSheets.ts` already exposes `replaceAllSheets(newSheets: { name, data }[])`
  — swaps in a full multi-tab dataset, resets history/selection, marks dirty.
  `SheetEditor.tsx`'s existing `handleImportSheet` is the exact pattern we
  want to mirror: parse external data → `sheets.replaceAllSheets(parsed)` →
  `persist.save()`. This is simpler than Diagrams' effect (no undo-stack /
  `canUndo`-gated autosave dance needed) because Sheets' `persist.save()` can
  be called directly and unconditionally.

## Plan

### 1. Extract shared sheet-file→data conversion (small refactor)

New file `web/apps/web/src/app/(apps)/sheets/editor/hooks/sheetFileUtils.ts`:
- Move `buildRawSheetMap` and `evaluateSheetMap` out of `usePersistence.ts`
  (verbatim) and export them.
- Add a new exported helper:
  `sheetFileToSheetsData(file: SheetFile): { name: string; data: Map<string, CellProps> }[]`
  that runs both passes and returns the array shape `replaceAllSheets` / `handleImportSheet` expect.
- `usePersistence.ts` imports `buildRawSheetMap`/`evaluateSheetMap` from this
  new module instead of defining them locally; its `load()` body is otherwise
  unchanged (it still needs the raw per-sheet arrays for extra-sheets-added-
  during-download handling, colWidths/rowHeights/charts/CF, so it keeps using
  the two lower-level functions directly rather than the new combinator).

### 2. Define the 20 templates

New file `web/apps/web/src/app/(apps)/sheets/editor/templates/sheetTemplates.ts`:

```ts
export interface SheetTemplate {
  id: string;
  name: string;
  description: string;
  preview: { headers: string[]; rows: string[][] }; // small hand-authored subset for the gallery mini-grid
  build: () => SheetFile; // full seeded content, applied on creation
}
export const SHEET_TEMPLATES: SheetTemplate[] = [ /* 20 entries */ ];
```

Each `build()` constructs a `SheetFile` (usually single-sheet, a couple use
2 tabs where natural, e.g. none required) with real headers + a handful of
illustrative sample rows, using formulas (`=SUM(...)`, subtraction, etc.)
where natural (totals, differences, invoice subtotal/tax/total, loan
amortization balances, KPI % of target). `preview` is a separate, small
(4-6 cols x 3-5 rows) hand-authored literal array — decoupled from `build()`
so the gallery stays cheap regardless of a given template's real size.

The 20 templates (structure per the task brief): Monthly Budget, Annual
Budget, Expense Tracker, Invoice, Quote/Estimate, Project Tracker, Task List,
Employee Timesheet, Employee Schedule, Inventory Management, Sales Pipeline,
CRM Contact List, Cash Flow Statement, Profit & Loss Statement, Loan
Amortization, Annual Calendar, Gantt Chart, KPI Dashboard, Retirement
Planner, Investment Portfolio Tracker.

### 3. Mini-grid preview component

New file `web/apps/web/src/app/(apps)/sheets/editor/components/MiniGridPreview.tsx`
(+ `.module.css`): a small presentational `<table>`-like grid rendering
`{ headers, rows }` with spreadsheet-ish styling (header row shaded, thin
borders, truncated cell text). Pure props in, no state.

### 4. Template picker modal

New file `web/apps/web/src/app/(apps)/sheets/editor/components/SheetTemplatePickerModal.tsx`
(+ `.module.css`): uses `Modal`/`ModalHeader`/`ModalBody` from `@neutrino/ui`
(`size="xl"`), grid of 20 cards (name, description, `MiniGridPreview`),
`onSelect(template)` callback — mirrors Diagrams' `TemplatePickerModal.tsx`
structurally but adds the live preview grid per card instead of an icon.

### 5. Wire up the two-step "New" flow

- `HamburgerMenu.tsx`: `New` action becomes `openDialog('new-choice')`
  instead of `openDialog('new')`.
- `ExportDialogs.tsx`:
  - New `hamburgerDialog === 'new-choice'` dialog: small modal (same
    `dialogOverlay`/`dialogBox` styling as the existing New/Duplicate
    dialogs) with two options — "Blank spreadsheet" (→ `setHamburgerDialog('new')`,
    i.e. falls into the existing unchanged name-input dialog) and "From
    template" (→ `setHamburgerDialog('new-template-gallery')`).
  - New `hamburgerDialog === 'new-template-gallery'`: renders
    `SheetTemplatePickerModal`; `onSelect(template)` stores the selected
    template in local state and transitions to `new-template-name`.
  - New `hamburgerDialog === 'new-template-name'`: same
    name-input dialog shape as `new`, defaulting the text field to
    `template.name`; Create calls `onCreateFromTemplate(template, title.trim())`.
  - New prop: `onCreateFromTemplate: (template: SheetTemplate, title: string) => Promise<void>`.
  - Existing `new` dialog (Blank) and its `onCreateNew` prop are untouched.
- `SheetEditor.tsx`:
  - New `handleNewFromTemplate` callback:
    ```ts
    const handleNewFromTemplate = useCallback(async (template: SheetTemplate, newTitle: string) => {
      const newSheet = await sheetsApi.createSheet({ title: newTitle });
      try {
        sessionStorage.setItem(`neutrino:sheet-template:${newSheet.id}`, JSON.stringify(template.build()));
      } catch { /* sessionStorage unavailable — sheet still opens, just blank */ }
      router.push(`/sheets/editor?id=${newSheet.id}`);
    }, [router]);
    ```
  - Passed to `ExportDialogs` as `onCreateFromTemplate={handleNewFromTemplate}`.
  - The `dekResolved` → `persist.load()` effect (~line 1466) is extended so
    that once `persist.load()` resolves, it checks
    `sessionStorage.getItem('neutrino:sheet-template:' + sheetId)`; if
    present, removes it, parses it as a `SheetFile`, converts via
    `sheetFileToSheetsData`, and — same pattern as `handleImportSheet` —
    calls `sheets.replaceAllSheets(parsed)` then `persist.save()`. This keeps
    template content entirely client-side: it never touches the server as
    plaintext, going through the same encrypted-save path as any manual edit
    or CSV import.

## Known risks / edge cases

- **Race with `persist.load()`'s own initial-plaintext re-encryption.** A
  freshly created sheet has server-written plaintext content (per the E2E
  encryption architecture note); `load()` already detects this
  (`serverHasPlaintextContent`) and re-encrypts via `queueSave()` *before*
  `load()`'s promise resolves. Applying the template only after `await
  persist.load()` returns, and calling `persist.save()` (not the queued
  variant) directly afterward — exactly as `handleImportSheet` already does
  — avoids clobbering or being clobbered, since `save()` always serializes
  from the current (now template-seeded) `sheetsDataRef`.
- **sessionStorage unavailable** (private browsing edge cases) — caught;
  sheet still opens, just blank, matching Diagrams' precedent.
- **Formula evaluation in templates** — must go through
  `sheetFileToSheetsData` (which runs `evaluateSheetMap`) rather than being
  dropped in as raw `CellProps` with no `value`, or formula cells would
  render blank until the user edits them.
- **20 templates is a lot of hand-authored data** — keeping each `build()`
  compact (a handful of rows) per the brief, and keeping `preview` decoupled
  and small, keeps the file readable and the gallery cheap to render.
- **Not duplicating the Docs-templates anti-pattern** — no server-side
  "use template" endpoint; everything is client-side + sessionStorage +
  the normal encrypted autosave path.
- Must not touch `photos/editor/PhotoCanvas.tsx` (unrelated pre-existing
  uncommitted change on this branch).
- No feature flag — ships enabled directly.

## Acceptance criteria

- Hamburger menu → New opens a Blank/Template chooser.
- Blank path is pixel-for-pixel the same UX as before (name dialog → create → navigate).
- Template path shows all 20 templates with real mini-grid previews (not images).
- Picking a template asks for a name (defaulting to the template's name),
  creates the sheet, and on landing in the editor the sheet is populated with
  the template's structure + sample rows (formulas computed/displayed where used).
- No server-side plaintext template content is ever written — only the
  encrypted autosave path is used for the actual content.
- `pnpm type-check` / `pnpm lint` pass for changed packages.

---

## Continuation: reorganize the hamburger menu into File/Edit/Format/(Insert) categories

Same branch, same PR (#53). This is a follow-on to the "New" submenu work
above — reorganizing `HamburgerMenu.tsx` from a flat item list into the
Docs-matching pattern: one hamburger icon, one panel, top-level items of
`kind: 'submenu'` that fly out into named categories on hover. This is **not**
a new always-visible File/Edit/Format button row — `HamburgerMenuBase` from
`@neutrino/ui` already supports arbitrarily nested submenus; no primitive
changes needed.

### Reference: Docs' MenuBar.tsx structure (mirrored, not copied verbatim)

`docs/editor/MenuBar.tsx` builds a `HamburgerMenuItem[]` tree with File / Edit
/ Format / Insert / View / Help top-level submenus. Docs has two literal no-op
stub actions (`Line spacing` options are `action: () => {}`) — explicitly
**not** replicating that anti-pattern here; every Sheets entry below calls a
real, already-existing function.

### What is changing and why

`sheets/editor/components/HamburgerMenu.tsx` is currently a flat list (New,
Save, Convert, Export, Import, Print, Duplicate, Version history, Delete,
Share, Offline). Reorganizing into categories improves discoverability and
adds Edit/Format entries that reuse `StyleToolbar`'s existing handlers,
giving keyboard/menu-only users a second path to the same actions — exactly
how Docs keeps both a rich-text `Toolbar` AND Format-menu Bold/Italic entries.

### Category mapping decided after reading `SheetEditor.tsx`, `StyleToolbar.tsx`, `hooks/useHistory.ts`, `hooks/useClipboard.ts`, `hooks/useCellEditing.ts`

**File** — straight move of the existing flat list, unchanged behavior:
New → Blank/Template, Save, (office mode) Convert to Neutrino Sheet, Import →
New sheet/New tab, Export → CSV/XLSX/HTML, Print, Duplicate, Version history,
—, Delete (danger), —, Share, Make available offline.

**Edit** — all wired to real functions, none reimplemented:
- Undo/Redo → `history.undo` / `history.redo`, disabled via
  `history.historyLen.undo/redo === 0` (same booleans `StyleToolbar` already
  uses as `canUndo`/`canRedo`).
- Cut/Copy/Paste → the exact same `document.execCommand('cut'|'copy'|'paste')`
  wrappers `SheetEditor.tsx` already defines for `SheetContextMenu`
  (`handleContextMenuCut/Copy/Paste`), passed through unchanged. (The "real"
  clipboard logic lives in `useClipboard`'s own document-level event
  listeners; execCommand is the established, already-shipping way other UI
  surfaces in this file trigger it.)
- Select all → **existing capability, previously only reachable via
  Ctrl+A**: `useHistory.ts` had the full range-selection logic inlined
  inside its keydown handler. Extracted (not reimplemented) into a
  `selectAll()` callback returned from the hook, and the keydown handler now
  calls that same function — so this is a refactor-for-reuse, not new
  functionality.
- Find and replace… → `setFindReplaceMode('replace')`, identical to what
  `StyleToolbar`'s existing find/replace toolbar button already calls.

**Format** — wired to `editing.applyStyle` / `editing.mergeCells` /
`editing.isMerged`, the same functions `StyleToolbar` uses, applied to the
current selection exactly as the toolbar does:
- Bold/Italic/Strikethrough (toggle, label shows ✓ when active, mirroring
  Docs' toggle-label convention). **Underline omitted** — `CellStyle.textDecoration`
  only has `'none' | 'line-through'`, there is no underline value in the real
  type, so adding an "Underline" entry would be inventing a capability that
  doesn't exist.
- Text color… / Fill color… — `window.prompt` for a hex value then
  `applyStyle({ color })` / `applyStyle({ backgroundColor })`. No new
  component: `HamburgerMenuItem` only supports plain action rows (no swatch
  picker), so a prompt-based entry (same pattern Docs already uses for
  Insert → Link/Image URLs) is the only way to expose this without adding
  primitive functionality. The full `ColorPickerPopover` swatch experience
  stays in `StyleToolbar` only.
- Borders (submenu: No border / Thin / Medium / Thick) → `applyStyle({ borderStyle })`.
- Number format (submenu: Currency / Percent / Number / Date, toggle
  on/off exactly like the toolbar's `$`/`%`/`#`/calendar buttons) →
  `applyStyle({ numberFormat })`.
- Merge cells / Unmerge cells (label reflects `isMerged`) → `editing.mergeCells()`.
- Clear formatting → `applyStyle()` called with every `CellStyle` key
  explicitly set to `undefined` — reuses the real `applyStyle` merge-patch
  function with a full-reset payload; not a new mutation path.
- **Omitted from Format**: font family/size (huge `<select>` list — Docs
  doesn't menu-ize its analogous long lists either), horizontal/vertical
  alignment, wrap mode, decimal places — all stay toolbar-only. These weren't
  in the Docs-parity ask and adding them isn't required for the reorg; they
  remain reachable via `StyleToolbar`.

**Insert** — only `Insert chart…` → the same `setShowChartDialog(true)`
`StyleToolbar`'s chart button already calls, and only included when
`flags.sheetsCharts` is on (mirrors how `StyleToolbar` itself conditionally
renders that button). Row/column insert (`handleInsertRowAbove` etc. in
`SheetEditor.tsx`) are **omitted** — they read from `contextMenu.cellId`
(right-click state), not the current selection, so calling them from the
hamburger menu (where `contextMenu` is `null`) would silently no-op. Adapting
them to selection-based input would be a behavior change/new code path, not
reuse — out of scope per "don't invent to fill a category."

**View** — **omitted entirely**. Searched for gridlines toggle, frozen
rows/columns, zoom level — none exist in the Sheets editor (only an
unrelated "Show gridlines" checkbox inside `ChartEditorPanel.tsx` for chart
axes, not the sheet grid). No real capability to map, so no stub category.

### Gating kept intact

`isViewer` continues to hide all mutating File items (unchanged) and now
also hides the entire Edit/Format/Insert categories (a viewer can't edit
cells at all, so none of those actions apply). `officeMode` still gates
"Convert to Neutrino Sheet" inside File.

### Files touched

- `sheets/editor/components/HamburgerMenu.tsx` — restructured into
  submenu categories; `Props` gains new callback props.
- `sheets/editor/SheetEditor.tsx` — passes the new callbacks through
  (all reusing handlers that already exist in this file/its hooks).
- `sheets/editor/hooks/useHistory.ts` — extracts `selectAll` as a named,
  returned callback (behavior-preserving refactor of existing Ctrl+A logic).
- New/updated test file under `apps/web/src/__tests__/sheets/` covering the
  new category structure and that a Format/Edit entry invokes the correct
  real handler.

### Risks / edge cases

- Menu-triggered Cut/Copy/Paste via `execCommand` depends on browser
  clipboard permissions same as the existing context-menu path — no new risk
  introduced, same mechanism already shipping.
- `selectAll` extraction must not change Ctrl+A's existing behavior — covered
  by keeping the exact same range-computation logic, only moved.
- Format menu items must reflect `disabled` state consistent with
  `StyleToolbar` (`!selectionAnchor || isViewer`) so menu and toolbar never
  disagree on availability.

### Acceptance criteria

- Hamburger menu shows File / Edit / Format (/ Insert when `sheetsCharts` is
  on) as top-level items that fly out submenus on hover, matching Docs'
  interaction pattern.
- Every new entry calls a real, pre-existing handler — zero stub actions.
- Clicking Format → Bold after selecting a cell produces the identical effect
  as clicking the toolbar's Bold button (and vice versa — state stays in sync
  since both read/write the same `editing.selectedCellStyle`/`applyStyle`).
- Clicking Edit → Undo after an edit undoes it, matching the toolbar's Undo
  button, with the same disabled-when-nothing-to-undo behavior.
- `isViewer` still hides all mutating entries; `officeMode` still gates
  Convert to Neutrino Sheet.
- `pnpm type-check` / `pnpm lint` pass for touched files; sheets test suite
  passes with no *new* failures (pre-existing unrelated
  `autosaveEncryptionWarning.test.tsx` failure not caused by this work).

---

## Continuation: Table styles gallery (28 presets)

Same branch, same PR (#53). Adds a toolbar-driven "table styles" feature: a
gallery of 28 pre-designed cell/table style presets (colored header row,
optional header column, optional total row, alternating row banding) that
apply in one click to the current selection.

### What is changing and why

Today `StyleToolbar.tsx` only exposes single-property style controls
(`applyStyle` applies one `Partial<CellStyle>` patch uniformly to every
selected cell). Table styles need *per-cell* patches within one selection
(header row cells get one look, body cells get banded looks, header column /
total row cells get another) — this requires a new selection-aware
application path, not a new UI control on top of the old one.

### Layers affected

- **Frontend only.** No backend changes — this only ever writes
  `CellStyle` patches into the existing in-memory `data` Map via the existing
  undo-patch machinery, exactly like every other formatting control.
- No new fields on `CellStyle` — `backgroundColor`/`color`/`fontWeight`/
  `borderStyle` already cover every visual need for these presets.
- No design-system additions — reuses `@neutrino/ui`'s `Modal`/`ModalHeader`/
  `ModalBody`/`ToolbarButton`, same primitives the template gallery (above)
  and the rest of `StyleToolbar` already use.
- Tests: unit tests for the pure geometry/patch function, a component test
  for the new gallery modal (mirroring `SheetTemplatePickerModal.test.tsx`).

### Existing code being reused (verified by reading, not assumed)

- `CellStyle` (`editor/types.ts` ~line 23) — used as-is.
- `applyStyle` (`hooks/useCellEditing.ts` ~line 513) — the undo-patch pattern
  (`buildReversePatch`/`applyPatch`/`pushPatchToUndo` vs. legacy
  `pushToUndo`) is generalized into a new sibling `applyStyleMap` that takes a
  `Map<cellId, Partial<CellStyle>>` instead of one shared patch, so different
  cells in the same selection can get different styles in a single undo step.
- `mergeCells` (~line 542) — the established `id.match(/^([A-Z]+)(\d+)$/)` +
  `alphaToNum`/`numToAlpha` → `minC/minR/maxC/maxR` pattern is reused verbatim
  for table-style geometry in a new standalone pure function (not inside the
  hook, so it's trivially unit-testable without React).
- `getRangeCells` (`editor/utils.ts`) — enumerates the selection's cell ids;
  already returned as `editing.selectedCells` from the hook and already
  threaded into `SheetEditor.tsx` (passed to `SheetGrid` at ~line 1782), so no
  new selection-tracking state is needed — `StyleToolbar` just needs the same
  set threaded in as a prop.
- `SheetTemplatePickerModal.tsx` (42 lines) — exact modal-gallery pattern to
  mirror (`Modal`/`ModalHeader`/`ModalBody`, CSS-module card grid, per-item
  preview + name/description, `onClick={() => onSelect(item)}`).
  `MiniGridPreview.tsx` is *not* reused directly (it renders an uncolored
  table) — a new `TableStylePreviewSwatch.tsx` renders a small colored grid
  reflecting a given style's actual colors instead.
- `StyleToolbar.tsx`'s `showFormatDialog` local-state + `CustomFormatDialog`
  render pattern (~line 103, ~line 393) is mirrored for the new gallery
  button/modal.

### Plan

1. **`editor/styles/tableStyles.ts`** — `TableStyle` interface + `TABLE_STYLES`
   (28 entries): a `PALETTE` array of the 14 given hue/color triples,
   `.flatMap`'d over two variant descriptors (`banded`:
   headerRow only; `headerTotals`: headerRow + headerColumn + totalRow),
   producing a concrete (not lazy) array.
2. **`editor/styles/applyTableStyle.ts`** — pure
   `computeTableStylePatches(style, cells: Set<string>): Map<string, Partial<CellStyle>>`,
   implementing the geometry/precedence algorithm from the brief: body patch
   with banding parity computed relative to the first body row
   (`bodyRowIndex = row - minR - headerOffset`), then header-column,
   header-row, total-row overrides in that order (each cell's own patch, not
   a shared one). No React/hooks — a standalone module, easily unit tested
   against small ranges.
3. **`hooks/useCellEditing.ts`** — add `applyStyleMap(styles: Map<string, Partial<CellStyle>>)`
   alongside `applyStyle`, reusing the exact same undo-batching logic
   (`buildReversePatch`/`applyPatch`, `pushPatchToUndo`/legacy-`pushToUndo`
   branching) but looking up each cell's patch from the map. Exported from
   the hook's return object.
4. **`components/TableStylePreviewSwatch.tsx`** (+ css module) — small
   presentational component rendering a 3-4×3-4 colored grid for one
   `TableStyle`, using `computeTableStylePatches` (or equivalent local logic)
   against a synthetic small range so the preview matches real output exactly.
5. **`components/TableStyleGalleryModal.tsx`** (+ css module) — mirrors
   `SheetTemplatePickerModal.tsx`: `Modal size="xl"` / `ModalHeader` /
   `ModalBody`, grid of 28 cards (`TableStylePreviewSwatch` + name), `onSelect
   (style)`.
6. **`StyleToolbar.tsx`** — new `showTableStyles` local state, new
   `ToolbarButton` (icon: `TableProperties` from `lucide-react`, confirmed to
   exist in this repo's installed version) titled "Table styles", disabled
   under the same condition as the rest of the toolbar (`disabled` prop,
   already `!selectionAnchor || isViewer` at the call site). New required
   prop `selectedCells: Set<string>` and `onApplyStyleMap: (m: Map<string,
   Partial<CellStyle>>) => void`. On select: `onApplyStyleMap(computeTableStylePatches(style, selectedCells))`, close modal.
7. **`SheetEditor.tsx`** (~line 1744 call site) — pass
   `selectedCells={editing.selectedCells}` and
   `onApplyStyleMap={editing.applyStyleMap}` to `StyleToolbar`.

### Known risks / edge cases

- **Banding parity reference point** — must be relative to the first body
  row (post-header), not the absolute selection top, or example 1's row
  immediately under the header would come out tinted instead of white. Unit
  tests assert this explicitly against both reference shapes.
- **1-row selections** — `totalRow` must not fire when `maxR === minR`
  (guarded explicitly per the brief) so a single selected row doesn't get
  double-mutated in a confusing way.
- **Undo must be one step** — achieved by building the whole `Map` of patches
  first and pushing a single `applyStyleMap` call (one `pushPatchToUndo`
  invocation), not one `applyStyle` call per cell.
- Must not touch `photos/editor/PhotoCanvas.tsx` (unrelated pre-existing
  uncommitted change on this branch).
- No feature flag — ships enabled directly.
- No `window.prompt`/`alert`/`confirm` anywhere in the new code.

### Acceptance criteria

- Toolbar has a "Table styles" button (disabled when no selection / viewer)
  that opens a gallery of exactly 28 styles.
- Selecting a "Banded" style applies a colored header row + alternating
  white/tint body rows, matching reference example 1.
- Selecting a "Header & Totals" style applies a colored header row, colored
  header column, and colored total row (bottom row of the selection), with
  interior cells still banded, matching reference example 2.
- The whole application is a single undo step.
- `computeTableStylePatches` unit tests cover both reference shapes with
  exact expected per-cell patches.
- Component test renders all 28 gallery cards and verifies clicking one
  invokes the apply path.
- `pnpm vitest run apps/web/src/__tests__/sheets`, `pnpm type-check`,
  `pnpm lint` pass for touched files, with no *new* failures beyond the
  known pre-existing `autosaveEncryptionWarning.test.tsx` failure.
