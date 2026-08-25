/**
 * Select-all must span the whole note body, not just whichever single block
 * happens to be a live <textarea> right now. Each block toggles between a
 * read-only <div> (view mode) and a <textarea> (edit mode, one at a time);
 * a native browser Selection can't reach into a focused <textarea>'s
 * internal text, so `selectAll` first forces every block back into view
 * mode, then builds a DOM Range over the whole container. See the matching
 * e2e coverage in e2e/tests/notes/note-select-all.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { createRef, useState } from 'react';

import BlockEditor, { type BlockEditorHandle } from '@/app/(apps)/notes/editor/BlockEditor';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';

function Harness({
  initial,
  editorRef,
}: {
  initial: Block[];
  editorRef: React.Ref<BlockEditorHandle>;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initial);
  return (
    <BlockEditor
      ref={editorRef}
      blocks={blocks}
      onChange={setBlocks}
      allNotes={[]}
      currentNoteId="note-1"
      onLinkClick={() => {}}
    />
  );
}

const BLOCKS: Block[] = [
  { id: 'b1', type: 'paragraph', content: 'Alpha block content' },
  { id: 'b2', type: 'paragraph', content: 'Beta block content' },
  { id: 'b3', type: 'paragraph', content: 'Gamma block content' },
];

function selectedText(): string {
  return window.getSelection()?.toString() ?? '';
}

describe('BlockEditor — selectAll', () => {
  it("selects every block's text even while one block is mid-edit", () => {
    const editorRef = createRef<BlockEditorHandle>();
    render(<Harness initial={BLOCKS} editorRef={editorRef} />);

    // Put block 2 into edit mode (a live <textarea>) — the exact state that
    // used to make Ctrl+A / the Select-all menu item only grab that one
    // block's text.
    fireEvent.click(screen.getByText('Beta block content'));
    expect(screen.getByLabelText('Block 2')).toBeInTheDocument();

    act(() => {
      editorRef.current?.selectAll();
    });

    const selected = selectedText();
    expect(selected).toContain('Alpha block content');
    expect(selected).toContain('Beta block content');
    expect(selected).toContain('Gamma block content');

    // The block being edited reverted to plain view-mode text — a Selection
    // can't span into a <textarea>'s internal text, so it has to give up
    // edit mode for the whole-note selection to include it at all.
    expect(screen.queryByLabelText('Block 2')).not.toBeInTheDocument();
  });

  /**
   * The regression: `selectAll` builds its Range immediately after bumping the
   * exit-edit signal inside `flushSync`, so the edited block has to be plain
   * text *by the time the call returns* — not one render later. It used to exit
   * edit mode from an effect, whose `setIsEditing(false)` landed after the
   * flush, so the Range was built while the block was still a <textarea> and
   * the whole-note selection came out as just the newlines between blocks.
   *
   * Deliberately not wrapped in `act()`: act flushes effects, which is what hid
   * this. A real Ctrl+A gets no such courtesy.
   */
  it('has left edit mode by the time selectAll returns, not a render later', () => {
    const editorRef = createRef<BlockEditorHandle>();
    render(<Harness initial={BLOCKS} editorRef={editorRef} />);

    fireEvent.click(screen.getByText('Beta block content'));
    expect(screen.getByLabelText('Block 2')).toBeInTheDocument();

    editorRef.current?.selectAll();

    expect(screen.queryByLabelText('Block 2')).not.toBeInTheDocument();
    expect(screen.getByText('Beta block content')).toBeInTheDocument();
  });

  it('works when no block is currently being edited', () => {
    const editorRef = createRef<BlockEditorHandle>();
    render(<Harness initial={BLOCKS} editorRef={editorRef} />);

    act(() => {
      editorRef.current?.selectAll();
    });

    const selected = selectedText();
    expect(selected).toContain('Alpha block content');
    expect(selected).toContain('Beta block content');
    expect(selected).toContain('Gamma block content');
  });
});
