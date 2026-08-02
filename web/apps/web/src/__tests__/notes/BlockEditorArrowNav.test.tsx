/**
 * Arrow-key navigation between blocks in the note editor (issue #61).
 *
 * Each block is its own textarea, so ArrowUp / ArrowDown used to do nothing at
 * the top / bottom line of a block. They should now move the caret into the
 * adjacent block, keeping the column, and skip over table blocks (which have no
 * textarea to focus).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';

import BlockEditor from '@/app/(apps)/notes/editor/BlockEditor';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';
import {
  caretColumn,
  caretIndexForColumn,
  isOnFirstLine,
  isOnLastLine,
} from '@/app/(apps)/notes/editor/blockEditorHelpers';

function Harness({ initial }: { initial: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initial);
  return (
    <BlockEditor
      blocks={blocks}
      onChange={setBlocks}
      allNotes={[]}
      currentNoteId="note-1"
      onLinkClick={() => {}}
    />
  );
}

const TEXTS = ['first block', 'second block', 'third block'];

/** Click a block's rendered view to put it into edit mode, then return its textarea. */
function editBlock(index: number): HTMLTextAreaElement {
  fireEvent.click(screen.getAllByText(TEXTS[index])[0]);
  return screen.getByLabelText(`Block ${index + 1}`) as HTMLTextAreaElement;
}

const BLOCKS: Block[] = TEXTS.map((content, i) => ({
  id: `b${i + 1}`,
  type: 'paragraph',
  content,
}));

/** requestAnimationFrame is used to apply the caret position after focus. */
async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('caret helpers', () => {
  it('reports the column relative to the current line', () => {
    expect(caretColumn('abc', 0)).toBe(0);
    expect(caretColumn('abc', 2)).toBe(2);
    expect(caretColumn('ab\ncdef', 5)).toBe(2);
    expect(caretColumn('\nabc', 0)).toBe(0);
  });

  it('detects the first and last line', () => {
    expect(isOnFirstLine('ab\ncd', 1)).toBe(true);
    expect(isOnFirstLine('ab\ncd', 4)).toBe(false);
    expect(isOnFirstLine('\nab', 0)).toBe(true);
    expect(isOnLastLine('ab\ncd', 4)).toBe(true);
    expect(isOnLastLine('ab\ncd', 1)).toBe(false);
  });

  it('maps a column onto the first or last line, clamping to its length', () => {
    expect(caretIndexForColumn('abcdef', 3, 'first')).toBe(3);
    expect(caretIndexForColumn('ab', 5, 'first')).toBe(2);
    expect(caretIndexForColumn('ab\ncdef', 5, 'first')).toBe(2);
    expect(caretIndexForColumn('ab\ncdef', 2, 'last')).toBe(5);
    expect(caretIndexForColumn('ab\ncd', 9, 'last')).toBe(5);
  });
});

describe('BlockEditor arrow-key navigation', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('ArrowDown at the last line moves the caret into the next block', async () => {
    render(<Harness initial={BLOCKS} />);

    const first = editBlock(0);
    first.setSelectionRange(3, 3);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await flushFrames();

    const second = screen.getByLabelText('Block 2') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(second);
    expect(second.selectionStart).toBe(3);
  });

  it('ArrowUp at the first line moves the caret into the previous block', async () => {
    render(<Harness initial={BLOCKS} />);

    const second = editBlock(1);
    second.setSelectionRange(2, 2);
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    await flushFrames();

    const first = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(first);
    expect(first.selectionStart).toBe(2);
  });

  it('stays inside the block when the caret is not on the edge line', async () => {
    render(
      <Harness
        initial={[
          { id: 'b1', type: 'paragraph', content: 'one\ntwo' },
          { id: 'b2', type: 'paragraph', content: 'next' },
        ]}
      />
    );

    fireEvent.click(screen.getAllByText(/one/)[0]);
    const first = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    first.setSelectionRange(1, 1); // first line of a two-line block
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await flushFrames();

    expect(document.activeElement).toBe(first);
  });

  it('does nothing at the very top or very bottom of the note', async () => {
    render(<Harness initial={BLOCKS} />);

    const first = editBlock(0);
    first.setSelectionRange(0, 0);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    await flushFrames();
    expect(document.activeElement).toBe(first);

    const third = editBlock(2);
    third.setSelectionRange(3, 3);
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    await flushFrames();
    expect(document.activeElement).toBe(third);
  });

  it('skips over table blocks, which have no textarea', async () => {
    render(
      <Harness
        initial={[
          { id: 'b1', type: 'paragraph', content: 'above' },
          {
            id: 'b2',
            type: 'table',
            content: '',
            tableData: {
              columns: [{ id: 'c1', width: 160 }],
              rows: [{ id: 'r1', cells: [{ id: 'cell1', content: '' }] }],
            },
          },
          { id: 'b3', type: 'paragraph', content: 'below' },
        ]}
      />
    );

    fireEvent.click(screen.getAllByText('above')[0]);
    const above = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    above.setSelectionRange(5, 5);
    fireEvent.keyDown(above, { key: 'ArrowDown' });
    await flushFrames();

    const below = screen.getByLabelText('Block 3') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(below);
  });

  it('leaves modified arrow keys and selections to the browser', async () => {
    render(<Harness initial={BLOCKS} />);

    const first = editBlock(0);
    first.setSelectionRange(0, 5); // a selection, not a caret
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await flushFrames();
    expect(document.activeElement).toBe(first);

    first.setSelectionRange(3, 3);
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });
    await flushFrames();
    expect(document.activeElement).toBe(first);
  });

  it('keeps the arrow keys driving the slash menu while it is open', async () => {
    render(<Harness initial={BLOCKS} />);

    const first = editBlock(0);
    fireEvent.change(first, { target: { value: '/' } });

    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await flushFrames();

    const updated = screen.getAllByRole('option');
    expect(updated[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(first);
  });
});
