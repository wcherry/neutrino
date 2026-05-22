# Manual Verification: Absolute Cell References

## Prerequisites

- The sheets application is running locally (or in a test environment)
- A spreadsheet is open in the editor

## Steps to Verify

### Happy Path — $A$1 (both locked)

1. Open a new spreadsheet
2. Set A1 = `10`
3. Set B2 = `=$A$1` — verify B2 displays `10`
4. Click B2, press Ctrl+C to copy
5. Click B5, press Ctrl+V to paste — verify B5 displays `10`
6. Click B5 and check the formula bar — it must show `=$A$1`
7. Click D10, press Ctrl+V to paste — verify D10 also displays `10` and formula bar shows `=$A$1`

### Happy Path — A$1 (row locked)

1. Set A1 = `100`, B1 = `200`
2. Set C1 = `=A$1` — verify C1 displays `100`
3. Copy C1 (Ctrl+C)
4. Click C3, paste (Ctrl+V) — verify C3 displays `100` and formula bar shows `=A$1` (row stays 1)
5. Click D1, paste (Ctrl+V) — verify D1 displays `200` and formula bar shows `=B$1` (column shifted A→B)

### Happy Path — $A1 (column locked)

1. Set A1 = `50`, A2 = `60`
2. Set B1 = `=$A1` — verify B1 displays `50`
3. Copy B1 (Ctrl+C)
4. Click D1, paste (Ctrl+V) — verify D1 displays `50` and formula bar shows `=$A1` (column stays A)
5. Click B2, paste (Ctrl+V) — verify B2 displays `60` and formula bar shows `=$A2` (row shifted 1→2)

### Absolute refs inside a range

1. Set A1=1, B1=2, A2=3, B2=4, A3=5, B3=6, A4=7, B4=8
2. Set C3 = `=SUM(A$1:B3)` — verify C3 displays `21` (1+2+3+4+5+6)
3. Copy C3, paste to C4
4. Verify C4 displays `36` (1+2+3+4+5+6+7+8) and formula bar shows `=SUM(A$1:B4)`

### Relative refs still work unchanged

1. Set A1 = `5`, B2 = `=A1`
2. Copy B2, paste to C3
3. Verify C3 displays `5` (or the value at B2 which is one up-left from C3) and formula bar shows `=B2`

### Edge Cases

#### Out-of-bounds relative ref returns #REF!

1. Set A1 = `=A$1` — this is valid (self-reference is unusual but should not crash)
2. Set B1 = `=$A1`
3. Copy B1, paste to A1 — if the column offset makes a ref go below column A, #REF! should appear

#### Formula bar shows $ markers when clicking

1. Set A1 = `=$B$2`
2. Click A1 — formula bar must show `=$B$2` (not `=B2`)

## Expected Results

- Cells with `$` anchors display the correct computed value at the target location
- The formula bar shows the formula with `$` markers preserved exactly
- Relative references continue to adjust normally when copied

## Rollback

This feature is an additive change to the formula parser. Formulas without `$` are unaffected.
To roll back, revert `utils.ts` and `formula.ts` to their previous versions.
