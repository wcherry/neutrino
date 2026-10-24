/**
 * CommentAnchorExtension — pins a comment to the text it is about.
 *
 * The anchor is a mark in the document carrying the comment's id, so it moves with edits, reaches
 * collaborators with the rest of the document and is encrypted with it; the comment itself (its
 * body, replies and status) stays on the server. `excludes: ''` lets two comments cover the same
 * text, each its own mark. In a `.docx` the mark is a hidden bookmark (see `ooxml/docx`).
 *
 * The mark draws nothing itself. What it looks like depends on things the document does not
 * know — whether the comment is open, which one is selected — so a plugin adds those as
 * decorations, from state the editor sets with `setCommentAnchorView`:
 * - `openIds`: comments shown as a marker. A resolved or deleted comment's anchor stays in the
 *   document but is not drawn.
 * - `activeId`: the selected comment, drawn stronger.
 * - `pending`: the selection a comment is being written about, before the comment exists. Mapped
 *   through every edit, so typing elsewhere while writing it does not shift it.
 *
 * A click on anchored text calls `onSelect` with the comment under it, or null when the click was
 * on text with no open comment.
 */

import { Mark, mergeAttributes } from '@tiptap/react';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

export const COMMENT_ANCHOR = 'commentAnchor';

interface Range { from: number; to: number }

interface CommentAnchorState {
  openIds: ReadonlySet<string>;
  activeId: string | null;
  pending: Range | null;
  decorations: DecorationSet;
}

type ViewMeta = Partial<Pick<CommentAnchorState, 'openIds' | 'activeId' | 'pending'>>;

export const commentAnchorKey = new PluginKey<CommentAnchorState>('commentAnchor');

/** Every stretch of text each comment's mark covers, in document order. */
export function commentAnchorRanges(doc: PmNode): Map<string, Range[]> {
  const out = new Map<string, Range[]>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_ANCHOR) continue;
      const id = String(mark.attrs.commentId ?? '');
      if (!id) continue;
      const ranges = out.get(id) ?? [];
      const last = ranges[ranges.length - 1];
      // Adjacent text nodes split by another mark are still one stretch of the comment.
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else ranges.push({ from: pos, to: pos + node.nodeSize });
      out.set(id, ranges);
    }
  });
  return out;
}

/** The text each comment is anchored to, its stretches joined with an ellipsis. */
export function commentAnchorTexts(doc: PmNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, ranges] of commentAnchorRanges(doc)) {
    out.set(id, ranges.map((r) => doc.textBetween(r.from, r.to, ' ')).join(' … '));
  }
  return out;
}

/** The open comments anchored at a document position, innermost (shortest) first. */
function openCommentsAt(state: EditorState, pos: number): string[] {
  const { openIds } = commentAnchorKey.getState(state)!;
  const $pos = state.doc.resolve(pos);
  const node = $pos.parent.childAfter($pos.parentOffset).node ?? $pos.nodeBefore;
  if (!node?.isText) return [];
  const ranges = commentAnchorRanges(state.doc);
  return node.marks
    .filter((m) => m.type.name === COMMENT_ANCHOR && openIds.has(String(m.attrs.commentId)))
    .map((m) => String(m.attrs.commentId))
    .sort((a, b) => length(ranges.get(a)) - length(ranges.get(b)));
}

const length = (ranges: Range[] | undefined) => (ranges ?? []).reduce((n, r) => n + r.to - r.from, 0);

function buildDecorations(doc: PmNode, s: Omit<CommentAnchorState, 'decorations'>): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [id, ranges] of commentAnchorRanges(doc)) {
    if (!s.openIds.has(id)) continue;
    const cls = id === s.activeId ? 'comment-anchor comment-anchor-active' : 'comment-anchor';
    for (const r of ranges) decorations.push(Decoration.inline(r.from, r.to, { class: cls, 'data-comment-id': id }));
  }
  if (s.pending && s.pending.to > s.pending.from) {
    decorations.push(Decoration.inline(s.pending.from, s.pending.to, { class: 'comment-anchor-pending' }));
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    commentAnchor: {
      /** What the editor shows: which comments are open, which is selected, what is being commented on. */
      setCommentAnchorView: (view: ViewMeta) => ReturnType;
      /** Anchor a new comment to the pending range, and clear it. */
      anchorPendingComment: (commentId: string) => ReturnType;
      /** Take a comment's anchor out of the document. */
      removeCommentAnchor: (commentId: string) => ReturnType;
    };
  }
}

export interface CommentAnchorOptions {
  onSelect: (commentId: string | null) => void;
}

export const CommentAnchorExtension = Mark.create<CommentAnchorOptions>({
  name: COMMENT_ANCHOR,
  excludes: '',
  inclusive: false,

  addOptions() {
    return { onSelect: () => {} };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-comment-anchor'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.commentId ? { 'data-comment-anchor': attrs.commentId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-anchor]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCommentAnchorView: (view) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(commentAnchorKey, view).setMeta('addToHistory', false));
        return true;
      },
      anchorPendingComment: (commentId) => ({ state, tr, dispatch }) => {
        const pending = commentAnchorKey.getState(state)?.pending;
        if (!pending || pending.to <= pending.from) return false;
        if (dispatch) {
          tr.addMark(pending.from, pending.to, state.schema.marks[COMMENT_ANCHOR].create({ commentId }));
          dispatch(tr.setMeta(commentAnchorKey, { pending: null }));
        }
        return true;
      },
      removeCommentAnchor: (commentId) => ({ state, tr, dispatch }) => {
        const ranges = commentAnchorRanges(state.doc).get(commentId);
        if (!ranges) return false;
        if (dispatch) {
          const type = state.schema.marks[COMMENT_ANCHOR];
          for (const r of ranges) tr.removeMark(r.from, r.to, type.create({ commentId }));
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<CommentAnchorState>({
        key: commentAnchorKey,
        state: {
          init(_config, state) {
            const s = { openIds: new Set<string>(), activeId: null, pending: null };
            return { ...s, decorations: buildDecorations(state.doc, s) };
          },
          apply(tr: Transaction, old, _oldState, newState) {
            const meta = tr.getMeta(commentAnchorKey) as ViewMeta | undefined;
            if (!meta && !tr.docChanged) return old;
            let pending = old.pending;
            if (pending && tr.docChanged) {
              pending = { from: tr.mapping.map(pending.from, 1), to: tr.mapping.map(pending.to, -1) };
            }
            const s = {
              openIds: meta?.openIds ?? old.openIds,
              activeId: meta && 'activeId' in meta ? meta.activeId ?? null : old.activeId,
              pending: meta && 'pending' in meta ? meta.pending ?? null : pending,
            };
            return { ...s, decorations: buildDecorations(newState.doc, s) };
          },
        },
        props: {
          decorations: (state) => commentAnchorKey.getState(state)?.decorations ?? DecorationSet.empty,
          handleClick: (view, pos, event) => {
            if (event.button !== 0) return false;
            const ids = openCommentsAt(view.state, pos);
            const { activeId } = commentAnchorKey.getState(view.state)!;
            // A second click on the same text moves through the comments stacked on it.
            const next = ids.length === 0 ? null : ids[(ids.indexOf(activeId ?? '') + 1) % ids.length];
            if (next !== activeId) options.onSelect(next);
            return false;
          },
        },
      }),
    ];
  },
});
