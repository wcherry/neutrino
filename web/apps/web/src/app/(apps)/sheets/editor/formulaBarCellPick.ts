/**
 * Formula-bar cell-pick helpers.
 *
 * insertCellRef splices a cell or range reference (e.g. "A1" or "A1:D4") into
 * a formula string at the given cursor position.  It replaces any partial
 * cell-reference token that sits immediately before the cursor so that repeated
 * picks during a drag update the same position rather than accumulating tokens.
 *
 * A "cell-reference token" is a maximal run of characters that belong to the
 * set [A-Za-z0-9:] immediately before the cursor.  Non-alphanumeric characters
 * that are not `:` (commas, open parens, operators, etc.) act as delimiters.
 *
 * Rules:
 *   - If `raw` does not start with `=`, it is returned unchanged (pick mode
 *     should never be active for non-formula values, but we guard anyway).
 *   - The token before the cursor is replaced with `ref`.
 *   - Text after the cursor is preserved.
 */

export type InsertCellRefResult = {
    /** The updated formula string. */
    raw: string;
    /** The new cursor position (end of the inserted reference). */
    cursorPos: number;
};

/**
 * Splices `ref` into `raw` at `cursorPos`, replacing any partial cell-
 * reference token that ends at the cursor.
 *
 * @param raw       Current formula string (e.g. `"=SUM(A"`)
 * @param cursorPos Caret position inside `raw` (0-based, like `selectionStart`)
 * @param ref       The reference to insert (e.g. `"B3"` or `"A1:D4"`)
 */
export function insertCellRef(raw: string, cursorPos: number, ref: string): InsertCellRefResult {
    // Only operate inside formulas.
    if (!raw.startsWith('=')) {
        return { raw, cursorPos };
    }

    // Find the start of the token immediately before the cursor.
    // Walk backwards while the character is a cell-reference constituent
    // ([A-Za-z0-9:]).  Stop at `=`, `(`, `,`, operators, or the start of the
    // string.
    let tokenStart = cursorPos;
    while (tokenStart > 0) {
        const ch = raw[tokenStart - 1];
        if (/[A-Za-z0-9:]/.test(ch)) {
            tokenStart--;
        } else {
            break;
        }
    }

    // Rebuild: everything before the token + ref + everything after the cursor.
    const before = raw.slice(0, tokenStart);
    const after = raw.slice(cursorPos);
    const next = before + ref + after;
    const nextCursor = tokenStart + ref.length;

    return { raw: next, cursorPos: nextCursor };
}

/**
 * Returns true when the formula bar is in "cell-pick" mode — i.e. there is an
 * active cell being edited whose raw value starts with `=`.
 */
export function isFormulaPickActive(raw: string | undefined): boolean {
    return typeof raw === 'string' && raw.startsWith('=');
}
