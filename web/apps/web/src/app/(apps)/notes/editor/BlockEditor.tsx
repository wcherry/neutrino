'use client';

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Block, BlockType, BlockEditorProps, FocusRequest } from './blockEditorTypes';
import { caretIndexForColumn, genId, blockToMarkdown } from './blockEditorHelpers';
import BlockRow from './BlockRow';
import styles from './BlockEditor.module.css';

// ── Re-exports for consumers that import from BlockEditor.tsx ─────────────────
export type { Block, BlockType } from './blockEditorTypes';
export { parseBlocks, serializeBlocks } from './blockEditorHelpers';

export interface BlockEditorHandle {
  /**
   * Select the entire note body — every block's rendered text, not just
   * whichever one is currently being edited. Blocks toggle between a
   * read-only <div> and a <textarea>, and a native browser Selection can't
   * span into a focused <textarea>'s internal text, so this first forces
   * every block back into (selectable) view mode, then builds a DOM Range
   * over the whole container.
   */
  selectAll: () => void;
}

// ── BlockEditor ───────────────────────────────────────────────────────────────

function BlockEditor({
  blocks,
  onChange,
  allNotes,
  currentNoteId,
  onLinkClick,
}: BlockEditorProps, ref: React.Ref<BlockEditorHandle>) {
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [exitEditNonce, setExitEditNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragFromIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    selectAll() {
      // Synchronous: the block still being edited must be a plain <div> in
      // the DOM before the Range below is built, not after React gets
      // around to it.
      flushSync(() => setExitEditNonce((n) => n + 1));
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection) return;
      const range = document.createRange();
      // From the first block's content to the last block's, rather than the
      // whole container: each row also holds a drag handle and a bullet/number
      // prefix, and although both are `user-select: none`, a range that crosses
      // them still serialises their empty boxes as line breaks — so copying a
      // whole note pasted with a blank line in front of it.
      const wrappers = container.querySelectorAll<HTMLElement>('[data-block-id]');
      const last = wrappers[wrappers.length - 1];
      if (last) {
        range.setStart(wrappers[0], 0);
        range.setEnd(last, last.childNodes.length);
      } else {
        range.selectNodeContents(container);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    },
  }));

  function updateBlock(id: string, patch: Partial<Block>) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function handleContentChange(id: string, content: string) {
    updateBlock(id, { content });
  }

  function handleTypeChange(id: string, type: BlockType) {
    updateBlock(id, { type });
  }

  function handleBlockPatch(id: string, patch: Partial<Block>) {
    updateBlock(id, patch);
  }

  function handleToggleCheck(id: string) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)));
  }

  function handleSplitBlock(id: string, before: string, after: string) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const current = blocks[idx];
    const newType: BlockType =
      current.type === 'bullet' || current.type === 'numbered' || current.type === 'task'
        ? current.type
        : 'paragraph';
    const newBlock: Block = { id: genId(), type: newType, content: after };
    onChange([
      ...blocks.slice(0, idx),
      { ...current, content: before },
      newBlock,
      ...blocks.slice(idx + 1),
    ]);
    setFocusRequest({ id: newBlock.id, position: 'start' });
  }

  function handleDeleteBlock(id: string) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1 || idx === 0) return;
    const prev = blocks[idx - 1];
    const cursorPos = prev.content.length;
    const merged: Block = { ...prev, content: prev.content + blocks[idx].content };
    onChange([...blocks.slice(0, idx - 1), merged, ...blocks.slice(idx + 1)]);
    setFocusRequest({ id: prev.id, position: cursorPos });
  }

  /**
   * Arrow up/down out of a block: focus the nearest editable neighbour, landing
   * on its last (moving up) or first (moving down) line at the same column.
   * Tables have no textarea to focus, so they are skipped over.
   */
  function handleMoveFocus(id: string, direction: 'up' | 'down', column: number) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const step = direction === 'up' ? -1 : 1;
    let target = idx + step;
    while (target >= 0 && target < blocks.length && blocks[target].type === 'table') {
      target += step;
    }
    if (target < 0 || target >= blocks.length) return;
    const next = blocks[target];
    setFocusRequest({
      id: next.id,
      position: caretIndexForColumn(next.content, column, direction === 'up' ? 'last' : 'first'),
    });
  }

  function handleDragStart(index: number) {
    dragFromIndex.current = index;
  }

  function handleDragOver(index: number) {
    setDragOverIndex(index);
  }

  function handleDrop() {
    const from = dragFromIndex.current;
    const to = dragOverIndex;
    dragFromIndex.current = null;
    setDragOverIndex(null);
    if (from === null || to === null || from === to) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  /**
   * Copying a selection that spans multiple blocks writes their Markdown
   * source (`- `, `1. `, `> `, table syntax, …) to the clipboard instead of
   * the rendered plain text — that's what the editor already stores, `**bold**`
   * and all, just normally shown as actual bold rather than literal asterisks.
   * A selection inside a single block is left to the browser's default copy:
   * there's no block-level prefix to add for a same-block substring, and
   * mapping a partial rendered selection back to raw inline-markdown offsets
   * (asterisks aren't visible in the rendered text) isn't reliable.
   */
  function handleCopy(e: React.ClipboardEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    const container = containerRef.current;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !container || !e.clipboardData) return;
    const range = selection.getRangeAt(0);

    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]')).filter(
      (el) => range.intersectsNode(el)
    );
    if (wrappers.length < 2) return;

    const parts = wrappers.map((el) => {
      const index = blocks.findIndex((b) => b.id === el.dataset.blockId);
      if (index === -1) return '';
      const block = blocks[index];

      const elRange = document.createRange();
      elRange.selectNodeContents(el);
      const fullyContained =
        range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0;
      if (fullyContained) return blockToMarkdown(block, blocks, index);

      // A boundary block only partly covered by the selection — its plain
      // selected substring (see the note above on why not markdown here).
      const clipped = document.createRange();
      if (range.compareBoundaryPoints(Range.START_TO_START, elRange) > 0) {
        clipped.setStart(range.startContainer, range.startOffset);
      } else {
        clipped.setStart(elRange.startContainer, elRange.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, elRange) < 0) {
        clipped.setEnd(range.endContainer, range.endOffset);
      } else {
        clipped.setEnd(elRange.endContainer, elRange.endOffset);
      }
      return clipped.toString();
    });

    e.clipboardData.setData('text/plain', parts.filter(Boolean).join('\n\n'));
    e.preventDefault();
  }

  return (
    <div className={styles.editor} ref={containerRef} onCopy={handleCopy}>
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          blockIndex={index}
          allBlocks={blocks}
          isFirst={index === 0}
          focusRequest={focusRequest}
          onFocusHandled={() => setFocusRequest(null)}
          exitEditSignal={exitEditNonce}
          onContentChange={handleContentChange}
          onTypeChange={handleTypeChange}
          onBlockPatch={handleBlockPatch}
          onToggleCheck={handleToggleCheck}
          onSplitBlock={handleSplitBlock}
          onDeleteBlock={handleDeleteBlock}
          onMoveFocus={handleMoveFocus}
          allNotes={allNotes}
          currentNoteId={currentNoteId}
          onLinkClick={onLinkClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          isDragOver={dragOverIndex === index}
        />
      ))}
    </div>
  );
}

export default forwardRef(BlockEditor);
