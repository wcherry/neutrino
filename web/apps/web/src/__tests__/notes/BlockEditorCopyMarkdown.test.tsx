/**
 * Copying a multi-block selection should write the blocks' Markdown source
 * to the clipboard (`- ` bullets, `**bold**`, etc.) rather than the rendered
 * plain text. This only covers the Range/DataTransfer structural logic —
 * jsdom has no real layout engine, so it can't reproduce the Chromium
 * user-select/draggable quirk that motivated moving the drag handle and
 * bullet/number glyphs to CSS-generated content (see BlockEditor.module.css
 * and the real-browser verification in the PR description instead).
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

import BlockEditor from '@/app/(apps)/notes/editor/BlockEditor';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';

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

const BLOCKS: Block[] = [
  { id: 'b1', type: 'paragraph', content: 'Alpha with **bold** text' },
  { id: 'b2', type: 'bullet', content: 'First bullet' },
  { id: 'b3', type: 'bullet', content: 'Second bullet' },
];

function selectFullBlocks(startId: string, endId: string) {
  const startEl = document.querySelector(`[data-block-id="${startId}"]`)!;
  const endEl = document.querySelector(`[data-block-id="${endId}"]`)!;
  const range = document.createRange();
  range.setStart(startEl, 0);
  range.setEnd(endEl, endEl.childNodes.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * `onCopy` is attached to BlockEditor's own root div, a descendant of
 * RTL's render() container — firing the event on that outer wrapper would
 * never reach it (events only bubble up to ancestors, never down to
 * children), so dispatch on any element actually inside the editor instead.
 */
function copyAndCapture(): string | undefined {
  const target = document.querySelector('[data-block-id]')!;
  const setDataMock = { text: undefined as string | undefined };
  const clipboardData = {
    setData: (type: string, value: string) => {
      if (type === 'text/plain') setDataMock.text = value;
    },
    getData: () => '',
    types: [],
  };
  fireEvent.copy(target, { clipboardData });
  return setDataMock.text;
}

describe('BlockEditor — copy writes Markdown for multi-block selections', () => {
  it('writes each fully-selected block as Markdown, joined with blank lines', () => {
    render(<Harness initial={BLOCKS} />);
    selectFullBlocks('b1', 'b3');

    const clipboardText = copyAndCapture();

    expect(clipboardText).toBe('Alpha with **bold** text\n\n- First bullet\n\n- Second bullet');
  });

  it('leaves a single-block selection to the native copy (does not intercept)', () => {
    render(<Harness initial={BLOCKS} />);
    selectFullBlocks('b2', 'b2');

    const clipboardText = copyAndCapture();

    expect(clipboardText).toBeUndefined();
  });
});
