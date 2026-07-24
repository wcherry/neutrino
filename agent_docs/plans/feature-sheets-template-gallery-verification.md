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
