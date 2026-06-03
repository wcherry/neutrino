/**
 * TrackChangesExtension
 *
 * A Tiptap extension implementing "suggesting mode" (track changes):
 *
 * - When suggesting mode is ON, all text insertions are wrapped in a
 *   `trackedInsertion` mark (rendered green).
 * - Deletions are replaced by a `trackedDeletion` mark over the deleted text
 *   (rendered red with strikethrough), so the original text remains visible
 *   but is clearly marked as removed.
 * - Commands: `toggleSuggestingMode`, `acceptChange`, `rejectChange`,
 *   `acceptAllChanges`, `rejectAllChanges`.
 *
 * Implementation notes:
 * - `appendTransaction` intercepts user-input transactions. We detect inserts
 *   and deletes by comparing the old and new document states.
 * - Guard: we only track changes when `suggestingMode` is true AND the
 *   transaction is a user input step (has `StepMap` changes and is not already
 *   a tracked-change meta transaction).
 */

import { Extension, Mark } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform';

// ── Plugin state ──────────────────────────────────────────────────────────────

interface TrackChangesPluginState {
  suggestingMode: boolean;
}

export const trackChangesPluginKey = new PluginKey<TrackChangesPluginState>('trackChanges');

// ── Marks ──────────────────────────────────────────────────────────────────────

/** Green highlight for inserted text in suggesting mode. */
export const TrackedInsertionMark = Mark.create({
  name: 'trackedInsertion',
  inclusive: false,

  addAttributes() {
    return {
      author: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'ins[data-tracked]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['ins', { 'data-tracked': 'insertion', ...HTMLAttributes }, 0];
  },
});

/** Red strikethrough for deleted text in suggesting mode. */
export const TrackedDeletionMark = Mark.create({
  name: 'trackedDeletion',
  // contenteditable=false would break ProseMirror's selection — we style it
  // as non-interactive via CSS only.
  inclusive: false,

  addAttributes() {
    return {
      author: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'del[data-tracked]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['del', { 'data-tracked': 'deletion', ...HTMLAttributes }, 0];
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const TRACK_META_KEY = 'isTrackChangesMutation';

function hasTrackedInsertionOrDeletion(node: PmNode, markType: string): boolean {
  let found = false;
  node.descendants(n => {
    if (n.marks.some(m => m.type.name === markType)) { found = true; return false; }
  });
  return found;
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    trackChanges: {
      toggleSuggestingMode: () => ReturnType;
      setSuggestingMode: (on: boolean) => ReturnType;
      acceptChange: (from: number, to: number) => ReturnType;
      rejectChange: (from: number, to: number) => ReturnType;
      acceptAllChanges: () => ReturnType;
      rejectAllChanges: () => ReturnType;
    };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────────

export const TrackChangesExtension = Extension.create({
  name: 'trackChanges',

  // We need TrackedInsertionMark and TrackedDeletionMark to be registered
  addExtensions() {
    return [TrackedInsertionMark, TrackedDeletionMark];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<TrackChangesPluginState>({
        key: trackChangesPluginKey,

        state: {
          init() {
            return { suggestingMode: false };
          },
          apply(tr, old) {
            const meta = tr.getMeta(trackChangesPluginKey) as Partial<TrackChangesPluginState> | undefined;
            if (meta) return { ...old, ...meta };
            return old;
          },
        },

        // Intercept user-input transactions and convert them to tracked changes
        appendTransaction(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
          const ps = trackChangesPluginKey.getState(newState);
          if (!ps?.suggestingMode) return null;

          // Only process genuine user-input transactions (not our own mutations)
          const userTxns = transactions.filter(
            tr => tr.docChanged && !tr.getMeta(TRACK_META_KEY) && !tr.getMeta('history$')
          );
          if (userTxns.length === 0) return null;

          const schema = newState.schema;
          const insertionMarkType = schema.marks['trackedInsertion'];
          const deletionMarkType = schema.marks['trackedDeletion'];
          if (!insertionMarkType || !deletionMarkType) return null;

          // Build a corrective transaction that undoes the plain edit and
          // re-applies it as tracked marks.
          let correction: Transaction | null = null;

          for (const tr of userTxns) {
            for (const step of tr.steps) {
              if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) continue;

              // ReplaceStep covers both pure deletions and insertions (and mixed).
              if (step instanceof ReplaceStep) {
                const from = step.from;
                const to = step.to;
                const slice = step.slice;
                const hasInsert = slice.content.size > 0;
                const hasDelete = to > from;

                // We need to undo newState's change and redo it as tracked marks.
                // Use the oldState to get the deleted text.
                if (!correction) {
                  correction = newState.tr;
                  correction.setMeta(TRACK_META_KEY, true);
                  // Start from newState doc; we'll patch using mapped positions.
                }

                // Map positions through any preceding steps in this corrective tr
                const map = correction.mapping;
                const mappedFrom = map.map(from);
                const mappedTo = map.map(to);

                if (hasDelete) {
                  // The deleted content is already gone from newState. We need
                  // to re-insert it as a trackedDeletion mark. Get the text
                  // from oldState.
                  const deletedSlice = oldState.doc.slice(from, to);
                  if (deletedSlice.content.size > 0) {
                    // Insert the deleted content back (before the inserted content)
                    correction.insert(mappedFrom, deletedSlice.content);
                    // Apply deletion mark to the re-inserted content
                    const reInsertedTo = mappedFrom + deletedSlice.content.size;
                    correction.addMark(mappedFrom, reInsertedTo, deletionMarkType.create());
                  }
                }

                if (hasInsert) {
                  // The inserted content is already in newState. Find where it landed.
                  const insertStart = mappedFrom + (hasDelete ? oldState.doc.slice(from, to).content.size : 0);
                  const insertEnd = insertStart + slice.content.size;
                  correction.addMark(insertStart, insertEnd, insertionMarkType.create());
                }
              }
            }
          }

          return correction;
        },
      }),
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      toggleSuggestingMode:
        () =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          const ps = trackChangesPluginKey.getState(state);
          const next = !ps?.suggestingMode;
          if (dispatch) {
            tr.setMeta(trackChangesPluginKey, { suggestingMode: next });
            dispatch(tr);
          }
          return true;
        },

      setSuggestingMode:
        (on: boolean) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
          if (dispatch) {
            tr.setMeta(trackChangesPluginKey, { suggestingMode: on });
            dispatch(tr);
          }
          return true;
        },

      acceptChange:
        (from: number, to: number) =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          if (!dispatch) return true;
          const schema = state.schema;
          const insertionMark = schema.marks['trackedInsertion'];
          const deletionMark = schema.marks['trackedDeletion'];

          tr.setMeta(TRACK_META_KEY, true);

          // Collect ranges with tracked marks, sorted by position descending
          // so that deletions in the slice can be removed without shifting.
          const toDelete: { from: number; to: number }[] = [];
          const toAccept: { from: number; to: number }[] = [];

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const nodeFrom = pos;
            const nodeTo = pos + node.nodeSize;
            const clipFrom = Math.max(nodeFrom, from);
            const clipTo = Math.min(nodeTo, to);
            if (node.marks.some(m => m.type === deletionMark)) {
              toDelete.push({ from: clipFrom, to: clipTo });
            } else if (node.marks.some(m => m.type === insertionMark)) {
              toAccept.push({ from: clipFrom, to: clipTo });
            }
          });

          // Remove deletion marks from deletions (accept = keep deleted text … wait, that's wrong)
          // Accept = keep the insertion, remove insertion mark
          //        = actually remove the deletion range from the document
          // Sort in reverse so position offsets stay stable
          const deleteRanges = [...toDelete].sort((a, b) => b.from - a.from);
          for (const r of deleteRanges) {
            tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
          }
          // Remove insertion marks from accepted insertions
          for (const r of toAccept) {
            tr.removeMark(tr.mapping.map(r.from), tr.mapping.map(r.to), insertionMark);
          }

          dispatch(tr);
          return true;
        },

      rejectChange:
        (from: number, to: number) =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          if (!dispatch) return true;
          const schema = state.schema;
          const insertionMark = schema.marks['trackedInsertion'];
          const deletionMark = schema.marks['trackedDeletion'];

          tr.setMeta(TRACK_META_KEY, true);

          // Reject = undo the tracked change
          // Deletion ranges: keep (restore them) by removing deletion mark
          // Insertion ranges: remove from document
          const toDeleteInsertion: { from: number; to: number }[] = [];
          const toRestoreDeletion: { from: number; to: number }[] = [];

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const nodeFrom = pos;
            const nodeTo = pos + node.nodeSize;
            const clipFrom = Math.max(nodeFrom, from);
            const clipTo = Math.min(nodeTo, to);
            if (node.marks.some(m => m.type === insertionMark)) {
              toDeleteInsertion.push({ from: clipFrom, to: clipTo });
            } else if (node.marks.some(m => m.type === deletionMark)) {
              toRestoreDeletion.push({ from: clipFrom, to: clipTo });
            }
          });

          const deleteRanges = [...toDeleteInsertion].sort((a, b) => b.from - a.from);
          for (const r of deleteRanges) {
            tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
          }
          for (const r of toRestoreDeletion) {
            tr.removeMark(tr.mapping.map(r.from), tr.mapping.map(r.to), deletionMark);
          }

          dispatch(tr);
          return true;
        },

      acceptAllChanges:
        () =>
        ({ state, dispatch, tr }: { state: EditorState; dispatch: ((tr: Transaction) => void) | undefined; tr: Transaction }) => {
          if (!dispatch) return true;
          const schema = state.schema;
          const insertionMark = schema.marks['trackedInsertion'];
          const deletionMark = schema.marks['trackedDeletion'];

          tr.setMeta(TRACK_META_KEY, true);

          const toDelete: { from: number; to: number }[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            if (node.marks.some(m => m.type === deletionMark)) {
              toDelete.push({ from: pos, to: pos + node.nodeSize });
            }
          });

          // Remove deletions in reverse order
          const sorted = toDelete.sort((a, b) => b.from - a.from);
          for (const r of sorted) {
            tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
          }

          // Remove insertion marks (keep the text)
          tr.removeMark(0, tr.doc.content.size, insertionMark);

          dispatch(tr);
          return true;
        },

      rejectAllChanges:
        () =>
        ({ state, dispatch, tr }: { state: EditorState; dispatch: ((tr: Transaction) => void) | undefined; tr: Transaction }) => {
          if (!dispatch) return true;
          const schema = state.schema;
          const insertionMark = schema.marks['trackedInsertion'];
          const deletionMark = schema.marks['trackedDeletion'];

          tr.setMeta(TRACK_META_KEY, true);

          const toDeleteInserted: { from: number; to: number }[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            if (node.marks.some(m => m.type === insertionMark)) {
              toDeleteInserted.push({ from: pos, to: pos + node.nodeSize });
            }
          });

          const sorted = toDeleteInserted.sort((a, b) => b.from - a.from);
          for (const r of sorted) {
            tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
          }

          // Restore deleted text by removing deletion marks
          tr.removeMark(0, tr.doc.content.size, deletionMark);

          dispatch(tr);
          return true;
        },
    };
  },
});

/** Returns true if suggesting mode is currently on. */
export function isSuggestingMode(state: EditorState): boolean {
  return trackChangesPluginKey.getState(state)?.suggestingMode ?? false;
}
