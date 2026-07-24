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
