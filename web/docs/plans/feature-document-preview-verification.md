# Manual Verification: Document Preview

## Prerequisites

- Feature flag `feature.documents.preview` enabled:
  ```
  NEXT_PUBLIC_FEATURE_DOCUMENT_PREVIEW=true
  ```
- At least one Doc, Sheet, Presentation, and Note created with some content.

## Steps to Verify

### Happy Path — Docs

1. Navigate to `/docs`.
2. Click any document card.
3. Verify the preview modal opens with the label "Document preview".
4. Verify the document body content renders as formatted text (headings, paragraphs, lists, etc.).
5. Verify the "Open in editor" button is visible in the header.
6. Click "Open in editor" — verify navigation to `/docs/editor?id=<id>`.

### Happy Path — Sheets

1. Navigate to `/sheets`.
2. Click any spreadsheet card.
3. Verify the preview modal opens with the label "Spreadsheet preview".
4. Verify column headers (A, B, C, …) and row numbers appear.
5. Verify cell values are rendered in the correct cells.
6. If any cells have custom background colors, verify those colors appear as-is and are NOT affected by dark theme.
7. Click "Open in editor" — verify navigation to `/sheets/editor?id=<id>`.

### Happy Path — Slides

1. Navigate to `/slides`.
2. Click any presentation card.
3. Verify the preview modal opens with the label "Presentation preview".
4. Verify a list of slide thumbnails appears, numbered 1, 2, 3, …
5. Verify text elements show their content inside the thumbnail.
6. Click "Open in editor" — verify navigation to `/slides/editor?id=<id>`.

### Happy Path — Notes

1. Navigate to `/notes`.
2. Click any note card.
3. Verify the preview modal opens with the label "Note preview".
4. Verify paragraphs, bullets, numbered items, code blocks, blockquotes, and tasks render correctly.
5. Verify completed tasks show with strikethrough text.
6. Click "Open in editor" — verify navigation to `/notes/editor?id=<id>`.

### Closing Behaviour

1. Open any preview modal.
2. Press **Escape** — verify the modal closes.
3. Open any preview modal again.
4. Click the **X** button in the top right — verify the modal closes.
5. Open any preview modal again.
6. Click the dark backdrop area (outside the white card) — verify the modal closes.

### Empty Documents

1. Create a new document/sheet/slide/note with no content and immediately open its preview.
2. Verify a graceful empty state is shown (spinner, then empty message or blank body — no crash).

### Edge Cases

1. Create a document with mixed content (bold, italic, table, image) — verify it renders without crashing.
2. If network is slow, verify the spinner shows while content is loading.

### Feature Flag Off

1. Unset `NEXT_PUBLIC_FEATURE_DOCUMENT_PREVIEW` (or set to `false`) and restart the dev server.
2. Click any document card in `/docs`, `/sheets`, `/slides`, or `/notes`.
3. Verify the user is navigated directly to the editor — no preview modal appears.
4. Re-enable the flag and verify previews work again.

### Sheet Cell Dark Theme Isolation

1. Enable dark theme (if the app supports it via the `feature.theme-switching` flag).
2. Open a sheet preview for a spreadsheet that has cells with custom background colors.
3. Verify the cell background colors remain unchanged in dark theme — they should match exactly what was set by the user in the editor.

## Expected Results

- Preview modal opens within 1–2 seconds (depending on document size and network).
- Content renders faithfully and read-only (no editable inputs, no toolbar).
- "Open in editor" always works from every document type.
- No console errors during normal usage.
- Sheet cell colors are immune to dark-mode overrides.

## Rollback

Disable `NEXT_PUBLIC_FEATURE_DOCUMENT_PREVIEW` — no deployment needed. All four listing pages fall back to navigating directly to the editor on card click.
