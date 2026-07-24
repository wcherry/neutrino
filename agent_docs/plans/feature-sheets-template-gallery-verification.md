# Manual Verification: Sheets "New from Template" Gallery

## Prerequisites
- [ ] A logged-in Neutrino account with access to Drive.
- [ ] Backend (port 8080) and frontend dev server (port 3000) running.

## Steps to Verify

### Happy Path — Blank spreadsheet (must be unchanged from before)
1. From Drive, click **+ New** > **Spreadsheet** to open a fresh sheet (or open any existing sheet).
2. Open the hamburger menu (☰ icon, top-left of the sheet editor toolbar) and click **New**.
3. Confirm a "New Spreadsheet" dialog appears offering **Blank spreadsheet** and **From template**.
4. Click **Blank spreadsheet**.
5. Confirm the original single-field "New Spreadsheet" name dialog appears, defaulting to "Untitled spreadsheet".
6. Change the name (optional) and click **Create**.
7. Confirm the browser navigates to a new sheet with the given name and a blank grid.

### Happy Path — From template
1. From within any open sheet, open the hamburger menu > **New**.
2. Click **From template**.
3. Confirm a gallery modal ("New from template") opens showing all **20** templates, each with:
   - A small live mini-grid preview (a real bordered table with header + a couple of sample rows — not a static image).
   - The template's name and a one-line description.
4. Click **Monthly Budget**.
5. Confirm a naming dialog appears, defaulting to "Monthly Budget".
6. Click **Create**.
7. Confirm the browser navigates to a new sheet titled "Monthly Budget", and the grid is populated with Category/Budgeted/Actual/Difference columns, Income/Expenses sections, and computed Difference/Total values (e.g. Utilities row shows -15, Total row shows 3020 / 3045 / -25).
8. Repeat steps 1-4 picking **Invoice**: confirm line items, computed `Total` per line (Qty × Unit Price), and computed Subtotal/Tax/Total (e.g. Subtotal 2370, Tax 189.6, Total 2559.6).
9. Repeat picking **Gantt Chart**: confirm Task/Owner/Start Date/End Date/Duration columns with computed Duration (days) values (e.g. Discovery = 7).

### Edge Cases
1. **Cancel out of each dialog stage** (choice dialog, gallery modal via the X, naming dialog) and confirm no sheet is created and you're returned to the editor with no side effects.
2. **Empty/whitespace name** in the template-naming dialog: confirm the Create button is disabled until a non-empty name is entered.
3. **Reload the page** after creating a sheet from a template: confirm the content persists (was actually saved server-side via the encrypted autosave path, not just held in memory).
4. **Repeat template creation multiple times in a row** from within the same open editor (New -> Template -> pick -> Create, then immediately New -> Template -> pick another -> Create): confirm each one lands on the correct new sheet with the correct seeded content (this exercises the same-pathname hard-navigation fix — each creation must fully load the new sheet's own content, not the previous one's).
5. **View a template card preview closely**: confirm header row is visually distinguished (shaded/bold) from data rows, consistent with light and dark theme.

## Expected Results
- Blank path behavior is identical to before this change.
- All 20 templates appear in the gallery with distinct, real-data mini-grid previews.
- Selecting any template creates a new sheet whose content matches that template's structure, including correctly computed formula values.
- No template content is ever visible in server logs/API responses as plaintext — it only ever reaches the server via the normal encrypted autosave path (same as any manual edit).

---

# Manual Verification: Hamburger menu reorganization (File/Edit/Format/Insert)

## Prerequisites
- [ ] A logged-in Neutrino account with access to Drive.
- [ ] Backend (port 8080) and frontend dev server (port 3000) running.
- [ ] An open spreadsheet (blank is fine) with at least one cell selected.

## Steps to Verify

### Happy path — menu structure
1. Open any sheet, click the hamburger icon (☰, top-left of the editor topbar).
2. Confirm the panel shows exactly **File**, **Edit**, **Format** as top-level rows, each with a right-facing chevron, plus **Insert** when chart creation is available in this environment (feature-flag `sheetsCharts`).
3. Hover **File** — confirm the existing items still appear unchanged: New (Blank/Template), Save, Export, Import, Print, Duplicate, Version history, Delete, Share, Make available offline (and "Convert to Neutrino Sheet" only when editing a raw Office file in place).
4. Hover **Edit** — confirm: Undo, Redo, —, Cut, Copy, Paste, —, Select all, —, Find and replace….
5. Hover **Format** — confirm: Bold, Italic, Strikethrough, —, Text color…, Fill color…, —, Borders ▸, Number format ▸, —, Merge cells, —, Clear formatting.
6. Hover **Insert** (if present) — confirm: Insert chart….

### Happy path — Edit actions reuse the real toolbar functions
1. Click a cell (e.g. A1), type some text, press Enter.
2. Open hamburger → Edit → **Undo**. Confirm the typed text is removed — identical to clicking the toolbar's Undo (↶) button.
3. With nothing left to undo, reopen Edit and confirm **Undo** is greyed out/disabled.
4. Retype the text, open Edit → **Redo** after an Undo, confirm it restores the text.
5. Select a cell with content, use Edit → **Copy**, click a different cell, use Edit → **Paste**: confirm the content is copied — same behavior as the right-click context menu's Copy/Paste.
6. With cells populated, Edit → **Select all**: confirm the full populated range (A1 through the bottom-right occupied cell) becomes selected, same as pressing Ctrl/Cmd+A.
7. Edit → **Find and replace…**: confirm the same Find/Replace panel opens as clicking the toolbar's search icon.

### Happy path — Format actions reuse the real toolbar functions
1. Select a cell with text. Open Format → **Bold**. Confirm the cell text becomes bold — identical to clicking the toolbar's **B** button — and the toolbar's Bold button shows as active/highlighted.
2. Reopen Format: confirm the entry now reads **"Bold ✓"**.
3. Repeat for Italic and Strikethrough.
4. Format → **Text color…**: enter a hex value in the prompt, confirm the cell's font color changes to match.
5. Format → **Fill color…**: same check for background color.
6. Format → **Borders** → **Thin**: confirm a thin border appears around the selection, matching the toolbar's border dropdown.
7. Format → **Number format** → **Currency**: confirm the cell displays as currency, matching the toolbar's `$` button; reopening and clicking **Currency** again toggles it back off.
8. Select a 2x2 range, Format → **Merge cells**: confirm the cells merge, same as the toolbar's merge button; reopening Format now shows **"Unmerge cells"**.
9. With a styled cell selected, Format → **Clear formatting**: confirm bold/italic/color/border/number-format are all removed in one action.

### Edge cases
1. **Viewer role** (open a sheet shared as "viewer", or check with `isViewer` state): confirm the Edit, Format, and Insert categories do not appear at all in the hamburger menu — only File (with its own mutating items already hidden, e.g. no Save/Delete/Duplicate).
2. **Office in-place-editing mode** (editing a raw `.xlsx`): confirm "Convert to Neutrino Sheet" still appears inside File, unaffected by the reorganization.
3. **No selection**: with no cell selected, confirm Format items are disabled (matches the toolbar being disabled with no selection).
4. **sheetsCharts flag off**: confirm the Insert category is entirely absent (not shown empty/disabled).

## Expected Results
- The hamburger menu now matches Docs' pattern exactly: one icon, one panel, categories fly out on hover.
- Every new Edit/Format/Insert entry produces the exact same effect as its corresponding toolbar button, with state (bold/merged/undo availability) staying in sync between the two.
- No stub/no-op menu entries exist anywhere in the new structure.
- `isViewer` and `officeMode` gating behave exactly as before.
