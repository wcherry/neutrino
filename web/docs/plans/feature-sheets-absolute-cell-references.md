# Plan: Absolute Cell References (Fixed Row/Column Anchoring)

## Branch
`feature/sheets-absolute-cell-references`

## What is changing and why

Users need to be able to "lock" a row, column, or both in a cell reference using the `$` prefix so that when a formula is copied to another cell, the locked dimension does not shift.

- `$A$1` — both locked: always references A1 regardless of where it is pasted
- `$A1`  — column locked, row relative: column stays A; row shifts with paste position
- `A$1`  — row locked, column relative: row stays 1; column shifts with paste position

## Layers affected

- **Frontend logic only** — formula engine is entirely frontend; no backend changes needed
- Files under `neutrino-web/apps/web/src/app/(apps)/sheets/editor/`
  - `utils.ts` — `encodeFormula`, `decodeFormula`, `parseDeps`
  - `formula.ts` — tokenizer (`tryReadCellRef`, `tokenize`)
- E2E tests under `neutrino-e2e/tests/sheets/`

## Architecture: encode/decode approach

The existing copy/paste pipeline works by:
1. **encodeFormula** (copy time): replace each `COL ROW` ref with `[colDelta][rowDelta]` tokens
2. **decodeFormula** (paste time): replace `[colDelta][rowDelta]` tokens with `COL ROW`

For absolute refs we extend the token encoding:
- Relative column delta: `[N]` (integer, e.g. `[0]`, `[-2]`)
- Absolute column:       `[$A]` (dollar + alpha, e.g. `[$AB]`)
- Relative row delta:    `[N]` (integer)
- Absolute row:          `[$1]` (dollar + digits, e.g. `[$12]`)

So the encoded form of `$A$1` is `[$A][$1]`, of `A$1` is `[0][$1]`, of `$A1` is `[$A][0]` (where `0` would be the row delta at encoding time).

During **decodeFormula**:
- If the column token starts with `$` → use the literal column alpha as-is (re-emit `$ALPHA`)
- Otherwise → add delta to target column
- Same for row

During serialisation the `$` markers are preserved in the reconstructed formula string.

## Changes per file

### `utils.ts`

**`encodeFormula`**

Current regex: `/([A-Z]+)(\d+)/g`  
Must be updated to: `/(\$?)([A-Z]+)(\$?)(\d+)/g`

- If `$` before column: emit `[$ALPHA]` instead of `[colDelta]`
- If `$` before row:    emit `[$NUM]` instead of `[rowDelta]`

**`decodeFormula`**

Current regex: `/\[(-?\d+)\]\[(-?\d+)\]/g`  
Must be updated to handle the new token forms:
- Column token: `\[(-?\d+|\$[A-Z]+)\]`
- Row token:    `\[(-?\d+|\$\d+)\]`

When column token starts with `$ALPHA`: output `$ALPHA` (absolute)
When column token is a number: output `numToAlpha(targetCol + delta)` (relative)
When row token starts with `$NUM`: output `$NUM` (absolute)
When row token is a number: output `targetRow + delta` (relative)

**`parseDeps`**

The regex `([A-Z]+\d+)` must strip optional leading `$` from column and row.
Updated to: `/(\$?[A-Z]+\$?\d+)/g` and strip `$` when adding to deps set.

### `formula.ts` — tokenizer

**`tryReadCellRef`**

Current signature reads from position `i` expecting `[A-Za-z]` at `s[i]`.
Must be updated to also consume an optional leading `$` before the column letters and an optional `$` before the digits.

Returns the cell string **with** `$` prefixes preserved so tokens carry the anchoring info.

**`tokenize`** — cross-sheet branch and standalone cell branch

Both branches call `tryReadCellRef`. The CELL token `value` and SHEET_CELL/SHEET_RANGE `start`/`end`/`cell` fields will now contain the `$` markers.

**`CELL` token handling in `parsePrimary` and `parseFuncArg`**

When looking up a CELL token in the data map, the key must be the plain cell ID (no `$`). Strip `$` when doing `data.get(tok.value)` — e.g. `tok.value.replace(/\$/g, '')`.

Same for range expansion in `expandRange` — the start/end refs passed must be plain (no `$`).

**`expandRange` calls** — anywhere `tok.start`/`tok.end` carry `$` markers, strip them before calling `expandRange`.

## Feature flag

No flag — this is a formula correctness fix/enhancement. It is purely additive (new syntax) and does not break existing formulas (plain refs have no `$` and continue to work as before).

## Known risks and edge cases

1. The `$` symbol is also used in currency formatting — ensure the tokenizer only interprets `$` as an anchor when it immediately precedes a column letter or digit within a cell reference context. This is safe because the tokenizer only enters the cell-ref branch when the character at position `i` is a letter or `$` followed by a letter.
2. Cross-sheet refs: `Beta!$A$1` — the `tryReadCellRef` call after `!` must also handle `$` prefixes. After the fix, SHEET_CELL and SHEET_RANGE tokens will carry `$`-prefixed cell strings; stripping happens at lookup time.
3. The encoded token regex in `decodeFormula` must not greedily match the `$` inside column names when the token is a relative delta. The two forms are disjoint: `[$A]` vs `[-2]`, so alternation with `\$[A-Z]+|\-?\d+` is unambiguous.

## Acceptance criteria

- `=$A$1` in any cell — after copy+paste in any direction, result is always `=$A$1`
- `=A$1` copied down one row — result stays `=A$1`
- `=A$1` copied right one column — result becomes `=B$1`
- `=$A1` copied right one column — result stays `=$A1`
- `=$A1` copied down one row — result becomes `=$A2`
- `=SUM(A$1:B3)` copied down one row — result is `=SUM(A$1:B4)`
- `=Beta!$A$1` copied anywhere — result stays `=Beta!$A$1`
- All existing relative references continue to work unchanged
- All existing unit tests pass

## Test plan

New E2E spec: `neutrino-e2e/tests/sheets/sheet-absolute-refs.spec.ts`

Tests:
1. `$A$1` copied in all four directions stays `$A$1`
2. `A$1` copied down stays on row 1; copied right adjusts column
3. `$A1` copied right stays on column A; copied down adjusts row
4. `=SUM(A$1:B3)` copied down — A$1 stays, B3 adjusts to B4
5. `=Beta!$A$1` copied anywhere stays `=Beta!$A$1`
