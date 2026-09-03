/**
 * Markdown shortcuts and slash commands in the note editor (issue #44).
 *
 * A note block stores markdown source (`**bold**`, `# Heading`, `---`) and
 * renders it, so "adding markdown" is a text edit plus a caret position. These
 * cover the pure helpers that do that edit, the key matching that picks one,
 * and the round trip through BlockEditor for the shortcuts and the `/` menu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';

import BlockEditor from '@/app/(apps)/notes/editor/BlockEditor';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';
import {
  blocksToHtml,
  isDividerContent,
  matchMarkdownShortcut,
  toggleHeadingPrefix,
  toggleInlineMarker,
} from '@/app/(apps)/notes/editor/blockEditorHelpers';

function Harness({ initial }: { initial: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initial);
  return (
    <BlockEditor
      blocks={blocks}
      onChange={setBlocks}
      allNotes={[{ id: 'note-2', title: 'Other note' }]}
      currentNoteId="note-1"
      onLinkClick={() => {}}
    />
  );
}

/** The caret is restored in a requestAnimationFrame after the content change. */
async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/** Click a block's rendered view to put it into edit mode, then return its textarea. */
function editBlock(text: string, index = 0): HTMLTextAreaElement {
  fireEvent.click(screen.getAllByText(text)[0]);
  return screen.getByLabelText(`Block ${index + 1}`) as HTMLTextAreaElement;
}

function press(
  ta: HTMLTextAreaElement,
  init: { key: string; code?: string; shiftKey?: boolean; altKey?: boolean }
) {
  fireEvent.keyDown(ta, { ctrlKey: true, ...init });
}

describe('toggleInlineMarker', () => {
  it('wraps a selection and keeps the text selected', () => {
    expect(toggleInlineMarker('one two', 4, 7, '**')).toEqual({
      content: 'one **two**',
      selectionStart: 6,
      selectionEnd: 9,
    });
  });

  it('unwraps when the markers are inside the selection', () => {
    expect(toggleInlineMarker('one **two**', 4, 11, '**')).toEqual({
      content: 'one two',
      selectionStart: 4,
      selectionEnd: 7,
    });
  });

  it('unwraps when the markers sit just outside the selection', () => {
    expect(toggleInlineMarker('one **two**', 6, 9, '**')).toEqual({
      content: 'one two',
      selectionStart: 4,
      selectionEnd: 7,
    });
  });

  it('inserts an empty pair at the caret, and takes it back out', () => {
    const inserted = toggleInlineMarker('ab', 1, 1, '~~');
    expect(inserted).toEqual({ content: 'a~~~~b', selectionStart: 3, selectionEnd: 3 });
    expect(toggleInlineMarker(inserted.content, 3, 3, '~~')).toEqual({
      content: 'ab',
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  it('does not read past the start of the content looking for a marker', () => {
    expect(toggleInlineMarker('ab', 0, 2, '`')).toEqual({
      content: '`ab`',
      selectionStart: 1,
      selectionEnd: 3,
    });
  });
});

describe('toggleHeadingPrefix', () => {
  it('adds, swaps and clears the prefix', () => {
    expect(toggleHeadingPrefix('Title', 1)).toBe('# Title');
    expect(toggleHeadingPrefix('# Title', 3)).toBe('### Title');
    expect(toggleHeadingPrefix('## Title', 0)).toBe('Title');
  });

  it('toggles off when asked for the level it already has', () => {
    expect(toggleHeadingPrefix('## Title', 2)).toBe('Title');
  });

  it('leaves a hash that is not a heading prefix alone', () => {
    expect(toggleHeadingPrefix('#hashtag', 0)).toBe('#hashtag');
  });
});

describe('matchMarkdownShortcut', () => {
  const base = { key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

  it('matches on either the key or the physical code', () => {
    expect(matchMarkdownShortcut({ ...base, ctrlKey: true, key: 'b', code: '' })?.label).toBe('Bold');
    // macOS turns Alt+1 into "¡" — the code is what identifies it there.
    expect(matchMarkdownShortcut({ ...base, metaKey: true, altKey: true, key: '¡', code: 'Digit1' })?.label)
      .toBe('Heading 1');
  });

  it('requires Ctrl/Cmd and an exact Shift/Alt match', () => {
    expect(matchMarkdownShortcut({ ...base, key: 'b', code: 'KeyB' })).toBeNull();
    expect(matchMarkdownShortcut({ ...base, ctrlKey: true, shiftKey: true, key: 'b', code: 'KeyB' })).toBeNull();
    expect(matchMarkdownShortcut({ ...base, ctrlKey: true, shiftKey: true, key: 'x', code: 'KeyX' })?.label)
      .toBe('Strikethrough');
  });
});

describe('divider', () => {
  it('recognises a rule of any of the three markdown characters', () => {
    expect(isDividerContent('---')).toBe(true);
    expect(isDividerContent('  *** ')).toBe(true);
    expect(isDividerContent('___')).toBe(true);
    expect(isDividerContent('--')).toBe(false);
    expect(isDividerContent('--- and text')).toBe(false);
  });

  it('renders as an <hr> in view mode, and in the HTML export', () => {
    const { container } = render(
      <Harness
        initial={[
          { id: 'b1', type: 'paragraph', content: 'above' },
          { id: 'b2', type: 'paragraph', content: '---' },
        ]}
      />
    );
    expect(container.querySelector('hr')).not.toBeNull();
    expect(blocksToHtml([{ id: 'b2', type: 'paragraph', content: '---' }])).toBe('<hr>');
  });

  it('exports a heading paragraph as a real heading', () => {
    expect(blocksToHtml([{ id: 'b1', type: 'paragraph', content: '## Section **two**' }])).toBe(
      '<h2>Section <strong>two</strong></h2>'
    );
  });
});

describe('BlockEditor markdown keyboard shortcuts', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('Ctrl+B wraps the selection in bold markers and keeps it selected', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'one two' }]} />);

    const ta = editBlock('one two');
    ta.setSelectionRange(4, 7);
    press(ta, { key: 'b', code: 'KeyB' });
    await flushFrames();

    const updated = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    expect(updated.value).toBe('one **two**');
    expect(updated.selectionStart).toBe(6);
    expect(updated.selectionEnd).toBe(9);
  });

  it('Ctrl+B again on the same words takes the markers back out', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'one **two**' }]} />);

    const ta = editBlock('one');
    ta.setSelectionRange(6, 9);
    press(ta, { key: 'b', code: 'KeyB' });
    await flushFrames();

    expect((screen.getByLabelText('Block 1') as HTMLTextAreaElement).value).toBe('one two');
  });

  it('Ctrl+Alt+2 makes the block a heading and moves the caret with the prefix', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'Title' }]} />);

    const ta = editBlock('Title');
    ta.setSelectionRange(5, 5);
    press(ta, { key: '2', code: 'Digit2', altKey: true });
    await flushFrames();

    const updated = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    expect(updated.value).toBe('## Title');
    expect(updated.selectionStart).toBe(8);
  });

  it('Ctrl+Shift+8 turns a paragraph into a bullet, and back again', async () => {
    const { container } = render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'item' }]} />);

    const ta = editBlock('item');
    press(ta, { key: '8', code: 'Digit8', shiftKey: true });
    await flushFrames();
    expect(container.querySelector('[class*="prefixBullet"]')).not.toBeNull();

    press(screen.getByLabelText('Block 1') as HTMLTextAreaElement, {
      key: '8',
      code: 'Digit8',
      shiftKey: true,
    });
    await flushFrames();
    expect(container.querySelector('[class*="prefixBullet"]')).toBeNull();
  });

  it('leaves inline markers out of a code block', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'code', content: 'let x = 1;' }]} />);

    const ta = editBlock('let x = 1;');
    ta.setSelectionRange(4, 5);
    press(ta, { key: 'b', code: 'KeyB' });
    await flushFrames();

    expect((screen.getByLabelText('Block 1') as HTMLTextAreaElement).value).toBe('let x = 1;');
  });

  it('Ctrl+K wraps the selection in a wiki link and opens the note autocomplete', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'see Other' }]} />);

    const ta = editBlock('see Other');
    ta.setSelectionRange(4, 9);
    press(ta, { key: 'k', code: 'KeyK' });
    await flushFrames();

    const updated = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    expect(updated.value).toBe('see [[Other]]');
    expect(updated.selectionStart).toBe(11);
    expect(screen.getByText('Other note')).toBeTruthy();
  });
});

describe('BlockEditor slash menu', () => {
  it('finds Heading 1 by its "h1" keyword and seeds the markdown prefix', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: 'text' }]} />);

    const ta = editBlock('text');
    fireEvent.change(ta, { target: { value: '/h1' } });

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Heading 1');

    fireEvent.keyDown(ta, { key: 'Enter' });
    await flushFrames();

    const updated = screen.getByLabelText('Block 1') as HTMLTextAreaElement;
    expect(updated.value).toBe('# ');
    expect(updated.selectionStart).toBe(2);
  });

  it('offers a divider under "hr", which applies as the rule markdown', async () => {
    render(<Harness initial={[{ id: 'b1', type: 'paragraph', content: '' }]} />);

    const ta = editBlock('Start writing… use / for block types, [[ to link notes');
    fireEvent.change(ta, { target: { value: '/hr' } });

    const option = (await screen.findAllByRole('option'))[0];
    expect(option.textContent).toContain('Divider');
    fireEvent.mouseDown(option);
    await flushFrames();

    // Still in edit mode, so this is the source — the rendered <hr> it becomes
    // on the way out of edit mode is covered by the divider tests above.
    expect((screen.getByLabelText('Block 1') as HTMLTextAreaElement).value).toBe('---');
  });
});
