/**
 * cellPatch.ts — small patch helpers for the cell Map.
 *
 * Instead of cloning the entire Map for every edit, we represent mutations as
 * a lightweight patch: a plain object keyed by cell ID.  Applying a patch
 * creates a new Map that shares all unchanged entries and only replaces /
 * inserts the cells listed in the patch.
 *
 * This reduces per-keystroke allocation from O(totalCells) to O(changedCells).
 *
 * Undo entries are also stored as reverse patches (prior values only for the
 * cells that actually changed) rather than full Map snapshots, cutting both
 * memory use and the cost of pushToUndo calls.
 */

import type { CellProps } from './types';

/** A patch is a plain-object map of cellId → new cell state (or undefined to delete). */
export type CellPatch = Record<string, CellProps | undefined>;

/**
 * Apply a patch to an existing data Map, returning a new Map reference.
 * Only the cells listed in the patch are updated; everything else is shared.
 *
 * This is O(changedCells) rather than O(allCells).
 */
export function applyPatch(
    base: Map<string, CellProps>,
    patch: CellPatch,
): Map<string, CellProps> {
    const next = new Map(base);
    for (const [id, cell] of Object.entries(patch)) {
        if (cell === undefined) {
            next.delete(id);
        } else {
            next.set(id, cell);
        }
    }
    return next;
}

/**
 * Build the reverse patch (undo record) for a set of cell IDs about to change.
 * Captures the current values so that applying the reverse patch restores them.
 */
export function buildReversePatch(
    base: Map<string, CellProps>,
    ids: Iterable<string>,
): CellPatch {
    const reverse: CellPatch = {};
    for (const id of ids) {
        // undefined means the cell did not exist before — restoring means deleting.
        reverse[id] = base.get(id);
    }
    return reverse;
}

/**
 * Represents a single undoable action as a forward + reverse patch pair.
 * Only the cells that actually changed are stored, so undo history is compact.
 */
export type UndoPatch = {
    /** The cell values BEFORE this action (for undo). */
    before: CellPatch;
    /** The cell values AFTER this action (for redo). */
    after: CellPatch;
};
