# Manual Verification: Advanced Formatting & Styles (Feature Gap #2)

## Prerequisites
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING=true` set in `.env.local`
- [ ] Open any Neutrino Doc in the editor (`/docs/editor?id=...`)

## Steps to Verify

### 1. Superscript / Subscript

1. Type a word (e.g. "H2O").
2. Select the "2".
3. Click the subscript button in the toolbar (looks like x₂).
4. **Expected:** "2" renders as a subscript character (`<sub>`).
5. With the cursor in the subscript text, click the superscript button.
6. **Expected:** subscript is removed, text becomes superscript.
7. Press Ctrl+. (Cmd+. on Mac) on selected text.
8. **Expected:** toggles superscript.
9. Press Ctrl+, to toggle subscript.

### 2. Text Case Controls

1. Type "hello world" and select all of it.
2. Click the "Aa" button in the toolbar.
3. Select "UPPERCASE" from the dropdown.
4. **Expected:** text becomes "HELLO WORLD".
5. Re-select and choose "Title Case".
6. **Expected:** text becomes "Hello World".
7. Re-select and choose "Sentence case".
8. **Expected:** text becomes "Hello world".
9. Re-select and choose "lowercase".
10. **Expected:** text becomes "hello world".
11. Verify via Format → Text case menu works the same way.

### 3. Paragraph Indent / Outdent

1. Click in a paragraph.
2. Click the Indent button (→→ icon) in the toolbar.
3. **Expected:** paragraph shifts 24 px to the right.
4. Click indent twice more.
5. **Expected:** paragraph is at 72 px indent.
6. Click Outdent (←← icon) three times.
7. **Expected:** paragraph returns to the left margin (0 px indent).
8. In a bullet list item, press Tab.
9. **Expected:** list item is nested one level deeper.
10. Press Shift+Tab.
11. **Expected:** list item returns to previous level.

### 4. List Style Types

1. Create a bullet list (Ctrl+Shift+8 or toolbar button).
2. With cursor inside the list, locate the small ▾ dropdown next to the list buttons.
3. Click it and choose "○ Circle".
4. **Expected:** bullet markers change to open circles.
5. Choose "■ Square".
6. **Expected:** bullet markers change to filled squares.
7. Switch to a numbered list (Ctrl+Shift+7).
8. Open the list style dropdown and choose "a. Lower alpha".
9. **Expected:** list markers change to a., b., c., ...
10. Choose "I. Upper roman".
11. **Expected:** markers become I., II., III., ...

### 5. Paragraph Styles Palette

1. Click the "Styles" button in the toolbar.
2. **Expected:** A modal opens with 12 named style buttons.
3. Click "Heading 2".
4. **Expected:** current paragraph becomes an H2 heading.
5. Click "Styles" again and choose "Quote".
6. **Expected:** paragraph becomes a blockquote with left border.
7. Click "Styles" again and choose "Normal".
8. **Expected:** paragraph returns to body text.
9. Verify same styles are accessible via Format → Paragraph styles… in the hamburger menu.

### 6. Table Cell Formatting

1. Insert a table (Insert → Table, or toolbar).
2. Click inside a cell.
3. Click the "Cell…" button in the table toolbar section.
4. **Expected:** Cell formatting modal opens.
5. Set a background colour (e.g. light yellow `#fef08a`).
6. Click Apply.
7. **Expected:** cell background turns yellow.
8. Re-open Cell…, set border colour to blue and border width to "2px".
9. Click Apply.
10. **Expected:** cell shows a thicker blue border.
11. Re-open Cell…, click "Clear" next to background colour, Apply.
12. **Expected:** cell background returns to default white.

### 7. Image — Local Upload

1. Click the image upload button in the toolbar (looks like a picture frame icon).
2. **Expected:** system file picker opens.
3. Select a local image file (JPG, PNG, GIF, WebP).
4. **Expected:** image is inserted inline into the document.
5. Large images should still load (stored as base64 data URL).

### 8. Image Properties

1. After inserting an image (see step 7), click on the image to select it.
2. Click the "Img…" button that appears in the toolbar.
3. **Expected:** Image properties modal opens showing Width, Alignment, Alt text, Caption fields.
4. Set Width to "300px" and click Apply.
5. **Expected:** image resizes to 300 px wide.
6. Open Image props again, set Alignment to "Center", Apply.
7. **Expected:** image is centered on the page.
8. Set Alignment to "Float left", Apply.
9. **Expected:** image floats left with text flowing around it.
10. Set Alt text to "My image", Apply.
11. **Expected:** image `alt` attribute is updated (inspect element to verify).

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING` from `.env.local` (or set to `false`).
2. Reload the editor.
3. **Expected:**
   - No superscript/subscript buttons in toolbar.
   - No "Styles" button in toolbar.
   - No "Aa" text case button.
   - No indent/outdent buttons.
   - No list style dropdown.
   - No "Img…" button when image is selected.
   - No "Cell…" button in table toolbar.
   - Image upload button still shows the URL prompt (legacy behaviour).
   - Format menu has no Superscript/Subscript/Indent/Outdent/Text case entries.
4. All existing documents load correctly.

## Expected Results
- All formatting controls work correctly when flag is `true`.
- Document content round-trips (save and reload) preserving all new formatting.
- Existing documents are unaffected when flag is `false`.
- No console errors in either flag state.

## Rollback
Set `NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING=false` (or remove the env var).
No deployment required — the flag defaults to off in production.
