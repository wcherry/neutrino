# Manual Verification: Sheet Live Embeds in Docs & Slides

## Prerequisites
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED=true` set in the target environment
- [ ] neutrino-sheets backend running with the `named_ranges` migration applied
- [ ] At least one spreadsheet with data in the Sheets editor

## Steps to Verify

### Happy Path — Paste into Docs

1. Open the Sheets editor and enter data in cells A1:C3 (e.g. Name/Age/City with 2 rows).
2. Select cells A1:C3.
3. Press Cmd+C / Ctrl+C to copy.
4. Open the Docs editor.
5. Click inside the document body.
6. Press Cmd+V / Ctrl+V to paste.
7. Verify the embed block appears showing the live table with header bar "Live sheet embed".
8. Verify the "Last updated: just now" label is shown.
9. Click the "↻" refresh button — verify the data reloads.

### Happy Path — Paste into Slides

1. Repeat steps 1–3 above.
2. Open the Slides editor.
3. Press Cmd+V / Ctrl+V.
4. Verify a `SheetEmbedElement` appears on the slide at position (10%, 20%) sized 80%×50%.
5. Verify the embed renders the live table data.
6. Drag the embed to reposition it; verify it moves.
7. Resize using corner handles; verify it resizes.

### Refresh / "Check for updates"

1. With a live embed in Docs, right-click on the embed block.
2. Verify "Check for updates" appears in the context menu.
3. Click it and verify the embed refreshes (loading state shown briefly).
4. Modify data in the source spreadsheet, return to Docs, and click "Check for updates".
5. Verify the embed shows the updated data.

### Deleted-sheet fallback

1. With a live embed in Docs, delete the source spreadsheet from the drive.
2. Click the "↻" refresh button on the embed.
3. Verify the embed transitions to the deleted state: "This sheet has been deleted."
4. Click "Convert to static table" — verify the embed is replaced by a static HTML table with the last-known data.
5. Undo and click "Remove embed" instead — verify the embed block is removed entirely.

### Stale data

1. With a live embed in Docs, simulate a backend outage (stop the sheets service).
2. Click "↻" refresh.
3. Verify the "Sheet data may be outdated." warning banner appears above the cached data.
4. Restore the service; click refresh again — verify the stale banner disappears.

### Edge Cases

1. Paste an empty selection (no cells selected) — verify no embed is inserted.
2. Paste a very large selection (100+ rows) — verify the embed renders and scroll works.
3. Open a document with an existing embed on load — verify it auto-fetches on mount.

### Feature Flag Off

1. Set `NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED=false` (or unset).
2. Copy a sheet selection and paste into Docs — verify standard paste behaviour (no embed offered).
3. Verify the `SheetEmbedExtension` is not registered in TipTap (no `sheetEmbed` node type).
4. Re-enable the flag to restore live-embed behaviour.

## Expected Results

- Pasting a copied sheet range with the flag on inserts a live embed block.
- The embed shows a table with a header bar, "Last updated: X" label, and a refresh button.
- Refreshing fetches current data from the sheets backend.
- If the source is deleted, the embed shows a recovery UI with "Convert to static table" and "Remove embed".
- If the backend is unreachable but cached data exists, the embed shows a stale-data warning.
- With the flag off, none of the above UI is available.

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED` — instant rollback without deployment.
Any existing embed nodes in saved documents will be silently ignored by TipTap when the extension is not registered.
