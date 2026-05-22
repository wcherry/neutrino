/**
 * Unit tests for formula-bar cell-pick logic.
 *
 * These tests cover the pure helper `insertCellRef` that splices a cell or
 * range reference into a formula string at a given cursor position.  The
 * function is extracted from `useCellEditing` and tested independently so we
 * don't need to spin up the full React hook.
 *
 * All tests start in the RED (failing) state — the implementation does not
 * exist yet.
 */

import { describe, it, expect } from 'vitest';
import { insertCellRef } from '../../app/(apps)/sheets/editor/formulaBarCellPick';

// ---------------------------------------------------------------------------
// insertCellRef
// ---------------------------------------------------------------------------

describe('insertCellRef', () => {
    // ── Basic insertion ──────────────────────────────────────────────────────

    it('inserts a single-cell reference after an open parenthesis', () => {
        // Formula: =SUM(  cursor at end (6)
        const result = insertCellRef('=SUM(', 5, 'A1');
        expect(result.raw).toBe('=SUM(A1');
        expect(result.cursorPos).toBe(7);
    });

    it('inserts a range reference after an open parenthesis', () => {
        const result = insertCellRef('=SUM(', 5, 'A1:D4');
        expect(result.raw).toBe('=SUM(A1:D4');
        expect(result.cursorPos).toBe(10);
    });

    it('inserts a reference after a comma', () => {
        // =SUM(A1,  cursor at end (8)
        const result = insertCellRef('=SUM(A1,', 8, 'B2');
        expect(result.raw).toBe('=SUM(A1,B2');
        expect(result.cursorPos).toBe(10);
    });

    // ── Replacement of existing partial reference ─────────────────────────

    it('replaces an existing single-cell reference at the cursor', () => {
        // User typed =SUM(A then clicked B3 — replace the partial "A"
        const result = insertCellRef('=SUM(A', 6, 'B3');
        expect(result.raw).toBe('=SUM(B3');
        expect(result.cursorPos).toBe(7);
    });

    it('replaces an existing complete reference at the cursor', () => {
        // User had already picked A1 and now picks C5
        const result = insertCellRef('=SUM(A1', 7, 'C5');
        expect(result.raw).toBe('=SUM(C5');
        expect(result.cursorPos).toBe(7);
    });

    it('replaces an existing range reference at the cursor', () => {
        // During drag: last pick was A1:B2, now the drag end moved to B4
        const result = insertCellRef('=SUM(A1:B2', 10, 'A1:B4');
        expect(result.raw).toBe('=SUM(A1:B4');
        expect(result.cursorPos).toBe(10);
    });

    // ── Cursor mid-formula ────────────────────────────────────────────────

    it('inserts at cursor position when cursor is mid-formula', () => {
        // =SUM(,B2) cursor at 5 (after open paren, before comma)
        const result = insertCellRef('=SUM(,B2)', 5, 'A1');
        expect(result.raw).toBe('=SUM(A1,B2)');
        expect(result.cursorPos).toBe(7);
    });

    it('replaces partial token when cursor is mid-formula', () => {
        // =SUM(A,B2) cursor at 6 (after partial "A")
        const result = insertCellRef('=SUM(A,B2)', 6, 'A3');
        expect(result.raw).toBe('=SUM(A3,B2)');
        expect(result.cursorPos).toBe(7);
    });

    // ── Bare equals sign ─────────────────────────────────────────────────

    it('replaces bare equals sign with =ref when user just typed =', () => {
        const result = insertCellRef('=', 1, 'A1');
        expect(result.raw).toBe('=A1');
        expect(result.cursorPos).toBe(3);
    });

    // ── Non-formula input (no leading =) ─────────────────────────────────

    it('returns the formula unchanged when raw does not start with =', () => {
        const result = insertCellRef('hello', 5, 'A1');
        expect(result.raw).toBe('hello');
        expect(result.cursorPos).toBe(5);
    });

    // ── Text after cursor is preserved ────────────────────────────────────

    it('preserves text after the cursor when inserting', () => {
        // =SUM(,) cursor at 5 (after paren)
        const result = insertCellRef('=SUM()', 5, 'A1');
        expect(result.raw).toBe('=SUM(A1)');
        expect(result.cursorPos).toBe(7);
    });

    it('replaces token before cursor and keeps text after cursor', () => {
        // =SUM(A1,) cursor at 8 (after A1,) — replace nothing, just insert
        const result = insertCellRef('=SUM(A1,)', 8, 'B2');
        expect(result.raw).toBe('=SUM(A1,B2)');
        expect(result.cursorPos).toBe(10);
    });
});
