'use client';

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Block, BlockType, BlockEditorProps, FocusRequest } from './blockEditorTypes';
import { caretIndexForColumn, genId } from './blockEditorHelpers';
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
      range.selectNodeContents(container);
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

  return (
    <div className={styles.editor} ref={containerRef}>
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
