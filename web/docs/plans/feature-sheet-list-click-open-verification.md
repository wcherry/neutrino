# Manual Verification: Sheet List Click-to-Open Document

## Prerequisites
- Dev server running (`pnpm dev`)
- Any documents created in Sheets, Docs, Notes, or Slides listing pages
- No feature flag required — this is an accessibility fix (always on)

## Steps to Verify

### Happy Path — Mouse Click

1. Navigate to `/sheets`
2. Observe the spreadsheet list (large-grid view by default)
3. Click any spreadsheet card
4. **Expected:** The spreadsheet opens (either the preview modal if `NEXT_PUBLIC_FEATURE_DOCUMENT_PREVIEW=true`, or navigates directly to `/sheets/editor?id=<id>`)
5. Switch to small-grid view (second icon in toolbar), click a card
6. **Expected:** Same behaviour as step 4
7. Switch to list view (third icon in toolbar), click a row
8. **Expected:** Same behaviour as step 4

### Happy Path — Keyboard Activation

1. Navigate to `/sheets` (large-grid view)
2. Press `Tab` until a spreadsheet card is focused (visible focus ring appears)
3. Press `Enter`
4. **Expected:** The spreadsheet opens, same as a mouse click
5. Navigate back, focus a card, press `Space`
6. **Expected:** The spreadsheet opens, same as a mouse click
7. **Expected:** The page does NOT scroll when Space is pressed

### Keyboard — Other Apps

Repeat the keyboard activation steps on `/docs`, `/notes`, and `/slides` to confirm the fix
applies to all document listing pages (they all use `FileGrid`).

### Star Badge and Menu Button Unaffected

1. Navigate to `/drive` which shows files with star badges and menu buttons
2. Tab to a card, then Tab again to reach the star badge button inside it
3. Press Space on the star badge — **Expected:** star is toggled, card click does NOT fire
4. Tab to the three-dot menu button, press Space — **Expected:** menu opens, card click does NOT fire

### Other Keys Do Nothing

1. Tab to a card
2. Press `ArrowDown`, `ArrowUp`, `Escape`, `a`
3. **Expected:** None of these keys trigger navigation

## Expected Results

- Mouse click: opens the document (preview modal or editor)
- Enter key: opens the document (same action as click)
- Space key: opens the document (same action as click), no page scroll
- Tab/Escape/Arrow keys: no action on the item

## Rollback

No feature flag. If a regression is found, revert the `onKeyDown` additions in
`FileGrid.tsx` and the `onKeyDown` prop in `Card.tsx`. The mouse-click behaviour
is completely unchanged.
