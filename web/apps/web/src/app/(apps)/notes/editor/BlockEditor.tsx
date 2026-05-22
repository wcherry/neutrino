'use client';

import React, { useRef, useState } from 'react';
import type { NoteMetaResponse } from '@/lib/api';
import type { Block, BlockType, BlockEditorProps, FocusRequest } from './blockEditorTypes';
import { genId } from './blockEditorHelpers';
import BlockRow from './BlockRow';
import styles from './BlockEditor.module.css';

// ── Re-exports for consumers that import from BlockEditor.tsx ─────────────────
export type { Block, BlockType } from './blockEditorTypes';
export { parseBlocks, serializeBlocks } from './blockEditorHelpers';

// ── BlockEditor ───────────────────────────────────────────────────────────────

export default function BlockEditor({
  blocks,
  onChange,
  allNotes,
  currentNoteId,
  onLinkClick,
}: BlockEditorProps) {
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const dragFromIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
    <div className={styles.editor}>
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          blockIndex={index}
          allBlocks={blocks}
          isFirst={index === 0}
          focusRequest={focusRequest}
          onFocusHandled={() => setFocusRequest(null)}
          onContentChange={handleContentChange}
          onTypeChange={handleTypeChange}
          onBlockPatch={handleBlockPatch}
          onToggleCheck={handleToggleCheck}
          onSplitBlock={handleSplitBlock}
          onDeleteBlock={handleDeleteBlock}
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
