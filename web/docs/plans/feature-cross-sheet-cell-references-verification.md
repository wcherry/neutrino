# Manual Verification: Cross-Sheet Cell References

## Prerequisites
- The application is running locally (http://localhost:9880)
- No feature flag required — the feature is always enabled
- A browser that supports modern JavaScript

## Steps to Verify

### Happy Path: Basic cross-sheet reference

1. Open the Sheets app and create a new spreadsheet
2. Click the "+" button at the bottom to add a second sheet tab
3. Double-click the "Sheet 2" tab and rename it to "Beta", press Enter
4. On the "Beta" sheet, click cell C4 and type "42", press Enter
5. Click the "Sheet 1" tab to switch back
6. Click cell A1 and type `=Beta!C4` in the formula bar, press Enter
7. **Expected:** Cell A1 displays "42"

### Happy Path: Cross-sheet range with SUM

1. Create a new spreadsheet with two sheets: "Sheet 1" and "Beta"
2. On "Beta", set:
   - C4=10, C5=20, C6=30, D4=5, D5=15, D6=25
3. Switch to "Sheet 1"
4. In cell A1, enter `=SUM(Beta!C4:D6)`
5. **Expected:** Cell A1 displays "105"

### Happy Path: Quoted sheet name with spaces

1. Create a new spreadsheet with two sheets
2. Rename the second tab to "Net Worth"
3. On "Net Worth", set C4 = 999
4. Switch to "Sheet 1"
5. In cell A1, enter `='Net Worth'!C4`
6. **Expected:** Cell A1 displays "999"

### Edge Case: Referenced sheet renamed

1. Create a spreadsheet with "Sheet 1" and a "Beta" tab
2. On "Beta", put 77 in C4
3. On "Sheet 1", enter `=Beta!C4` in A1 — expect "77"
4. Double-click the "Beta" tab and rename it to "Gamma", press Enter
5. Click a different cell, then click A1 again to trigger re-evaluation
6. **Expected:** Cell A1 displays "#REF!" (Beta no longer exists)

### Edge Case: Referenced sheet deleted

1. Create a spreadsheet with "Sheet 1" and "Beta" tab
2. On "Beta", put 55 in C4
3. On "Sheet 1", enter `=Beta!C4` in A1 — expect "55"
4. Right-click the "Beta" tab and select Delete from the context menu
5. Click another cell, then click A1 to trigger re-evaluation
6. **Expected:** Cell A1 displays "#REF!"

### Edge Case: Referenced cells cleared

1. Create a spreadsheet with "Sheet 1" and "Beta" tab
2. On "Beta", set C4 = 100
3. On "Sheet 1", enter `=Beta!C4` in A1 — expect "100"
4. Switch to "Beta", clear C4 by clicking it and pressing Delete
5. Switch to "Sheet 1", click another cell then click A1
6. **Expected:** Cell A1 displays "" (empty) or "0"

## Expected Results

| Scenario | Cell | Expected Value |
|---|---|---|
| =Beta!C4 where Beta.C4=42 | A1 | 42 |
| =SUM(Beta!C4:D6) with values 10,20,30,5,15,25 | A1 | 105 |
| ='Net Worth'!C4 where 'Net Worth'.C4=999 | A1 | 999 |
| =Beta!C4 after renaming Beta→Gamma | A1 | #REF! |
| =Beta!C4 after deleting Beta | A1 | #REF! |
| =Beta!C4 after clearing Beta.C4 | A1 | "" or 0 |

## Rollback

No feature flag — the change is purely additive (new syntax that wasn't supported before). Existing formulas that don't use the `!` operator are completely unaffected.

To revert if needed, roll back the `feature/cross-sheet-cell-references` branch changes.
