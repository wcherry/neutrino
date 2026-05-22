# Implementation Plan: Sheet Live Embed

## Feature flag
- Name: `NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED`
- JS key: `featureFlags.sheetLiveEmbed`
- Default: OFF in all environments

## What is changing and why
Users can paste a live link to a selected range of cells from the Sheets editor into a Docs or Slides document. The embed stays in sync: if cells update in the source spreadsheet, a "Check for updates" action refreshes the rendered data. If the source sheet is deleted, the embed offers fallback actions.

## Layers affected

### neutrino-sheets (Rust backend)
1. Migration: `named_ranges` table (`id UUID PK`, `sheet_id TEXT FK → sheets.file_id`, `sheet_db_id TEXT` — the parent spreadsheet/file ID, `start_row INT`, `start_col INT`, `end_row INT`, `end_col INT`, `created_at`, `updated_at`)
2. `POST /api/v1/sheets/:id/named-ranges` — upsert a named range for a selection, return `{ id, sheetId, sheetDbId, startRow, startCol, endRow, endCol }`
3. `GET /api/v1/sheets/:id/embed/:named_range_id` — resolve named range → bounds → return cell data as `CellValue[][]`
4. Row/col shift logic: on future row/col insert-delete operations (stub hooks for now — the table supports it)
5. New files: `named_ranges/` module (model, dto, repository, service, api)

### @neutrino/api-sheets (TS package)
- `createNamedRange(sheetId, body)` → POST named-range endpoint
- `getSheetEmbed(sheetId, namedRangeId)` → GET embed endpoint
- New shared types: `NamedRangeResponse`, `CreateNamedRangeRequest`, `SheetEmbedResponse`

### @neutrino/sheet-embed (new TS package)
- Types: `SheetEmbedAttrs`, `CellValue`, `EmbedStatus`
- `useSheetEmbed` hook: fetches and caches embed data, handles deleted-source state
- `SheetEmbedRenderer` component: renders the live table, loading state, and deleted-source error state (with "Convert to static" and "Remove embed" actions)
- `useSheetPasteInterceptor` hook: detects clipboard content that looks like a Neutrino sheet selection and calls `createNamedRange`

### neutrino-web / docs editor
- Add `sheetLiveEmbed` to `featureFlags`
- TipTap `SheetEmbedExtension`: custom node with `sheetId`, `namedRangeId`, `cachedData`, `cachedAt` attrs
- Wire paste interceptor in `DocEditor.tsx`
- Add "Check for updates" item to `EditorContextMenu.tsx`

### neutrino-web / slides editor
- Add `SheetEmbedElement` type to `slideEditorTypes.ts`
- Render `SheetEmbedRenderer` in `SlideCanvas.tsx`
- Wire paste interceptor in `SlideEditor.tsx`
- Add "Check for updates" to slide element context menu

## Known risks and edge cases
- Named range ID must be stable even when rows shift — the `named_ranges` record row bounds update but the GUID stays
- Embed endpoint must not require auth (documents can be shared publicly) — use a separate unauthenticated path, or allow bearer-optional
- `cachedData` can be large for wide ranges — cap at 500 rows × 100 cols in validation
- The clipboard format for a "Neutrino sheet selection" must be detectable without false positives — use a custom MIME type `application/x-neutrino-sheet-selection`

## Acceptance criteria
- [ ] Pasting a copied sheet selection in Docs inserts a `SheetEmbed` block showing the live data
- [ ] Pasting in Slides inserts a `SheetEmbed` element on the current slide
- [ ] "Check for updates" refreshes the displayed data from the backend
- [ ] When the source sheet is deleted, the embed shows the inline error state with both actions
- [ ] "Convert to static table" replaces the embed with a plain table using `cachedData`
- [ ] "Remove embed" deletes the block/element
- [ ] Inserting rows above the range in the source sheet does not break the embed (named range shifts)
- [ ] Feature flag off → paste behaves as before, no embed block inserted
