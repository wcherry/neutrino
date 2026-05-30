# Manual Verification: Docs Layout & Structure

## Prerequisites
- Feature flag `NEXT_PUBLIC_FEATURE_DOCS_LAYOUT_STRUCTURE=true` set in `.env.local` in `web/apps/web/`
- Dev server running: `pnpm dev` from the `web/` directory
- A document open in the Docs editor (create one or use an existing one)

## Steps to Verify

### 1. Headers & Footers

1. Open Format menu → "Header & footer…"
2. Enter "Document Title" in the Header field
3. Enter "Page {{page}}" in the Footer field
4. Check the "Show page numbers" checkbox
5. Click Apply
6. **Expected:** A dashed line appears at the top of the page with "Document Title" text and another at the bottom with "Page 1"

### 2. Watermark

1. Open Format menu → "Watermark…"
2. Enter "DRAFT" in the watermark text field
3. Click Apply
4. **Expected:** Large, faint, rotated "DRAFT" text appears diagonally across the page

### 3. Page Background

1. Open Format menu → "Watermark…"
2. Use the color picker to select a light yellow (#fffde7)
3. Click Apply
4. **Expected:** The page background changes to light yellow

### 4. Document Themes

1. Open Format menu → "Document theme…"
2. Click "Corporate" then Apply
3. **Expected:** All headings in the document turn navy blue (#003366)
4. Re-open the theme modal, select "Academic", Apply
5. **Expected:** Body text switches to Georgia serif font
6. Re-open, select "Minimal", Apply
7. **Expected:** H1 becomes lighter-weight/smaller, H3 gets uppercase treatment
8. Reset to "Default"

### 5. Table of Contents

1. Add several headings (H1, H2, H3) to the document
2. Open Insert menu → "Table of contents"
3. **Expected:** A TOC block appears with all headings listed and indented by level
4. Clicking a TOC entry scrolls to the corresponding heading
5. Add a new heading — the TOC auto-updates

### 6. Footnotes

1. Click somewhere in a paragraph
2. Insert menu → "Footnote"
3. Enter footnote text in the prompt (e.g. "See also Chapter 2")
4. Click OK
5. **Expected:** A blue superscript number appears at the cursor. A footnote section with a divider line appears at the bottom of the page showing the footnote text
6. Click the footnote marker
7. **Expected:** Page scrolls to the footnote at the bottom

### 7. Cross-references

1. Select a word or phrase in the document
2. Insert menu → "Cross-reference…"
3. Enter an exact heading text (e.g. "Introduction")
4. **Expected:** The selected text becomes a blue underlined link with `data-cross-ref` attribute
5. Click the cross-reference link
6. **Expected:** Page scrolls to the matching heading

### 8. Section Breaks

1. Place cursor between two paragraphs
2. Insert menu → "Section break"
3. **Expected:** A dashed horizontal line separator appears at that position
4. Print the document (Ctrl+P) — the break should cause a page break in print preview

### 9. Column Layouts

1. Insert menu → "2-column layout"
2. Type several lines of text in the inserted block
3. **Expected:** Text flows in two side-by-side columns
4. Insert a "3-column layout"
5. **Expected:** Text flows in three columns

### 10. Save & Reload Persistence

1. Configure header, footer, watermark, and theme
2. Save (Ctrl+S)
3. Navigate away and return to the document
4. **Expected:** All layout settings are preserved (header, footer, page numbers, watermark, theme, background color)

### Edge Cases

#### Empty header/footer
1. Open Header & footer modal, clear both fields, Apply
2. **Expected:** Header and footer zones disappear from the page

#### Watermark reset
1. Set a watermark, Apply
2. Re-open Watermark modal, clear the text field, Apply
3. **Expected:** Watermark disappears

#### TOC with no headings
1. Insert a TOC in a document with no headings
2. **Expected:** TOC block shows "Add headings to generate a Table of Contents."

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_DOCS_LAYOUT_STRUCTURE=true` from `.env.local`
2. Restart dev server
3. Open any document
4. **Expected:**
   - No "Table of contents", "Footnote", "Cross-reference…", "Section break", or column items in Insert menu
   - No "Header & footer…", "Watermark…", or "Document theme…" in Format menu
   - No header/footer zones on the page
   - Documents saved without the flag use plain Tiptap JSON (fully backward-compatible)

## Expected Results Summary

| Feature | On-screen result |
|---|---|
| Header | Dashed zone at top of page with text |
| Footer | Dashed zone at bottom of page with text |
| Page numbers | `{{page}}` replaced with page number |
| Watermark | Faded diagonal text overlay |
| Background color | Page background changes |
| Theme: Corporate | Navy blue headings |
| Theme: Academic | Serif body font |
| Theme: Minimal | Lighter-weight headings |
| TOC | Live-updating block with clickable entries |
| Footnotes | Numbered superscripts + bottom footnote list |
| Cross-references | Blue underlined links that scroll to headings |
| Section break | Dashed horizontal rule, prints as page break |
| 2-column layout | Side-by-side two-column text flow |
| 3-column layout | Three-column text flow |

## Rollback

Disable `NEXT_PUBLIC_FEATURE_DOCS_LAYOUT_STRUCTURE` — instant rollback, no deployment required.

Documents saved with the flag on store data in `{ doc, _meta }` wrapper format.
Documents saved with the flag off continue to use plain Tiptap JSON.
Both formats are readable when the flag is on; plain JSON is always readable when off.
