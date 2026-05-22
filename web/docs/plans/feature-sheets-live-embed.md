# Plan: Sheets Live Embed in Docs and Slides

## Branch
`feature/sheets-live-embed` (neutrino-web and neutrino-sheets)

## What Is Changing and Why

Users need to embed live sheet data into their Docs and Slides documents. When they
copy cells from neutrino-sheets (which writes the `application/x-neutrino-sheet`
MIME type to the clipboard), and then paste into the Docs or Slides editor, they
should be offered two choices:

1. **Paste as table** — converts the clipboard cells into a static TipTap/slide
   table node. No live connection. Works today for plain text; this feature makes
   it a first-class action with a dialog prompt.
2. **Paste as live view** — inserts a "live sheet embed" block that stores only the
   sheet ID (and optional cell range) and fetches current data from the sheets API
   on mount and on demand.

## Layers Affected

| Layer | Change |
|---|---|
| **Shared package** (new `@neutrino/sheet-embed`) | Types, `useSheetEmbed` hook, `SheetEmbedBlock` renderer, `useSheetPasteInterceptor` hook |
| **neutrino-sheets backend** | New `GET /api/v1/sheets/:id/embed` endpoint returning resolved cell values for a given range |
| **neutrino-web / @neutrino/api-sheets** | Add `getSheetEmbed(id, range?)` to the API client |
| **Docs editor** | Register TipTap `SheetEmbedExtension`, handle paste event, add context-menu item "Check for updates" |
| **Slides editor** | Add `SheetEmbedElement` type to slide types, render embed in canvas, handle paste |
| **Feature flag** | `feature.editors.sheetLiveEmbed` gates the paste prompt and embed block |

## New Shared Package: `@neutrino/sheet-embed`

Lives at `neutrino-web/packages/sheet-embed/`.

Exports:
- `SheetEmbedAttrs` — the node attributes stored in doc/slide JSON:
  `{ sheetId: string; range?: string; lastUpdatedAt?: string }`
- `useSheetEmbed(sheetId, range?)` — React hook that fetches embed data via the
  sheets API, returns `{ rows, isLoading, error, refetch, lastUpdatedAt }`
- `SheetEmbedRenderer` — React component that renders the fetched rows as an HTML
  table with a "last updated" footer and a "Check for updates" button
- `useSheetPasteInterceptor(onSheetPaste)` — hook for paste event detection;
  calls `onSheetPaste` with the parsed `x-neutrino-sheet` payload when detected

## Backend Endpoint (neutrino-sheets)

`GET /api/v1/sheets/:id/embed?range=A1:D10`

Returns evaluated cell values (not raw formulas) for the requested range,
shaped for direct table rendering:

```json
{
  "sheetId": "uuid",
  "range": "A1:D10",
  "rows": [["Header A", "Header B"], ["val1", "val2"]],
  "updatedAt": "2026-05-07T12:00:00Z"
}
```

The range defaults to all populated cells when omitted (up to 500 rows × 26 cols).
Authorization: same bearer-token check as all other sheets endpoints.

## Docs Editor Integration

- Import `SheetEmbedExtension` (a custom TipTap Node extension wrapping `SheetEmbedRenderer`)
- Add it to the `extensions` array in `DocEditor.tsx`
- Hook into the ProseMirror paste handler via TipTap `editorProps.handlePaste`; detect `application/x-neutrino-sheet`; show a small inline dialog (`SheetPasteDialog`) with "Paste as table" / "Paste as live view"
- "Paste as table": derive the row/col grid from clipboard cells and insert a TipTap table node
- "Paste as live view": call `editor.commands.insertSheetEmbed({ sheetId, range })`
- Add "Check for updates" to `EditorContextMenu` when cursor is inside a sheet embed node

## Slides Editor Integration

- Extend `slideEditorTypes.ts` with `SheetEmbedElement` (type `'sheet-embed'`)
- In `SlideCanvas.tsx` render `SheetEmbedRenderer` for elements of that type
- In `SlideEditor.tsx` add an "Add Sheet Embed" toolbar button (gated by flag)
- Detect `application/x-neutrino-sheet` on the existing `onPaste` handler at the
  canvas level; show the same paste dialog

## Feature Flag

Name: `feature.editors.sheetLiveEmbed`
Env var: `NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED`
Default: `false` everywhere.

Both the paste interception dialog and the embed block rendering are gated by
this flag. When off, pasting sheet clipboard data falls through to the existing
plain-text paste behavior.

## Known Risks and Edge Cases

- Sheet deleted after embed inserted: `getSheetEmbed` returns 404 → renderer
  shows a "Sheet not available" error state
- Sheet content URL requires the drive API read flow (not a direct SQL query):
  the embed endpoint reads the sheet's `content_url` from drive storage, parses
  the `SheetFile` JSON, and evaluates values server-side
- Large ranges: cap at 500×26; include `truncated: true` in response
- Encryption: sheets can be E2E-encrypted (like docs/slides). For the MVP the
  embed endpoint only works for non-encrypted sheets; encrypted sheets show a
  "Cannot embed encrypted sheet" message in the renderer

## Acceptance Criteria

- [ ] Copying cells in neutrino-sheets and pasting in Docs shows the paste dialog (when flag on)
- [ ] "Paste as table" inserts a static table matching the clipboard data
- [ ] "Paste as live view" inserts an embed block that fetches and renders current sheet data
- [ ] "Check for updates" in the context menu re-fetches the embed
- [ ] "Last updated" timestamp is displayed in the embed renderer
- [ ] Same paste dialog behavior works in Slides
- [ ] When flag is off, paste falls through to existing behavior (no prompt)
- [ ] Deleted sheet shows error state in embed block
- [ ] All unit and E2E tests pass
