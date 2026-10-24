/**
 * A comment pinned to its text: the pending range while the comment is written, the mark once it
 * exists, the marker for open comments only, and a click on the text selecting its comment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  CommentAnchorExtension,
  commentAnchorKey,
  commentAnchorRanges,
  commentAnchorTexts,
} from '@/lib/extensions/CommentAnchorExtension';

let editor: Editor;
let onSelect: ReturnType<typeof vi.fn>;

/** Position of the first occurrence of `text` in the (one-paragraph) document, across marks. */
function find(text: string): { from: number; to: number } {
  const i = editor.state.doc.firstChild!.textContent.indexOf(text);
  // The paragraph's content starts at position 1.
  return { from: 1 + i, to: 1 + i + text.length };
}

const decorationClasses = () =>
  (commentAnchorKey.getState(editor.state)!.decorations.find() as { type: { attrs: { class: string } } }[])
    .map((d) => d.type.attrs.class);

/** Comment on `text`: mark it pending, then anchor the new comment. */
function comment(text: string, id: string) {
  editor.commands.setCommentAnchorView({ pending: find(text) });
  editor.commands.anchorPendingComment(id);
}

beforeEach(() => {
  onSelect = vi.fn();
  editor = new Editor({
    extensions: [StarterKit, CommentAnchorExtension.configure({ onSelect })],
    content: '<p>The quick brown fox jumps over the lazy dog</p>',
  });
});

afterEach(() => editor.destroy());

describe('CommentAnchorExtension', () => {
  it('anchors a new comment to the text that was selected when it was started', () => {
    comment('brown fox', 'c1');
    expect(commentAnchorTexts(editor.state.doc)).toEqual(new Map([['c1', 'brown fox']]));
    expect(commentAnchorKey.getState(editor.state)!.pending).toBeNull();
  });

  it('keeps the pending range on its text while the document is edited elsewhere', () => {
    editor.commands.setCommentAnchorView({ pending: find('lazy dog') });
    editor.commands.insertContentAt(1, 'Look: ');
    editor.commands.anchorPendingComment('c1');
    expect(commentAnchorTexts(editor.state.doc).get('c1')).toBe('lazy dog');
  });

  it('marks only open comments, and the selected one more strongly', () => {
    comment('quick', 'c1');
    comment('lazy', 'c2');
    expect(decorationClasses()).toEqual([]);

    editor.commands.setCommentAnchorView({ openIds: new Set(['c1']) });
    expect(decorationClasses()).toEqual(['comment-anchor']);

    editor.commands.setCommentAnchorView({ openIds: new Set(['c1', 'c2']), activeId: 'c2' });
    expect(decorationClasses().sort()).toEqual(['comment-anchor', 'comment-anchor comment-anchor-active']);
  });

  it('lets two comments cover the same text', () => {
    comment('brown fox', 'c1');
    comment('fox jumps', 'c2');
    const texts = commentAnchorTexts(editor.state.doc);
    expect(texts.get('c1')).toBe('brown fox');
    expect(texts.get('c2')).toBe('fox jumps');
  });

  it('takes a deleted comment’s anchor out of the document', () => {
    comment('brown fox', 'c1');
    editor.commands.removeCommentAnchor('c1');
    expect(commentAnchorRanges(editor.state.doc).size).toBe(0);
  });

  describe('a click on the text', () => {
    const click = (pos: number) =>
      editor.view.someProp('handleClick', (f) => f(editor.view, pos, new MouseEvent('click', { button: 0 })));

    beforeEach(() => {
      comment('brown fox', 'c1');
      comment('fox', 'c2');
      editor.commands.setCommentAnchorView({ openIds: new Set(['c1', 'c2']) });
    });

    it('selects the comment on it', () => {
      click(find('brown').from + 1);
      expect(onSelect).toHaveBeenLastCalledWith('c1');
    });

    it('selects the innermost comment first, then the next one on the same text', () => {
      click(find('fox').from + 1);
      expect(onSelect).toHaveBeenLastCalledWith('c2');
      editor.commands.setCommentAnchorView({ activeId: 'c2' });
      click(find('fox').from + 1);
      expect(onSelect).toHaveBeenLastCalledWith('c1');
    });

    it('clears the selection on text with no open comment', () => {
      editor.commands.setCommentAnchorView({ activeId: 'c1' });
      click(find('lazy').from + 1);
      expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it('ignores a resolved comment’s text', () => {
      editor.commands.setCommentAnchorView({ openIds: new Set(['c2']) });
      click(find('brown').from + 1);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
