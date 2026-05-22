'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { NoteMetaResponse } from '@/lib/api';
import type { Block, BlockType, BlockRowProps, FocusRequest } from './blockEditorTypes';
import { SLASH_COMMANDS } from './blockEditorConstants';
import {
  createDefaultTable,
  getWikiLinkQuery,
  insertWikiLink,
  renderInline,
  numberedIndexInGroup,
} from './blockEditorHelpers';
import TableBlock from './TableBlock';
import styles from './BlockEditor.module.css';

export default function BlockRow({
  block,
  blockIndex,
  allBlocks,
  isFirst,
  focusRequest,
  onFocusHandled,
  onContentChange,
  onTypeChange,
  onBlockPatch,
  onToggleCheck,
  onSplitBlock,
  onDeleteBlock,
  allNotes,
  currentNoteId,
  onLinkClick,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: BlockRowProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [acQuery, setAcQuery] = useState<string | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  // Stores a pending cursor position to apply once the textarea mounts
  const pendingFocusPositionRef = useRef<'start' | 'end' | number | null>(null);

  // Handle focus requests from parent (Enter / Backspace merge)
  useEffect(() => {
    if (!focusRequest || focusRequest.id !== block.id) return;
    pendingFocusPositionRef.current = focusRequest.position;
    setIsEditing(true);
    onFocusHandled();
  }, [focusRequest, block.id, onFocusHandled]);

  // Once isEditing becomes true, apply any pending cursor position
  useEffect(() => {
    if (!isEditing || pendingFocusPositionRef.current === null) return;
    const pos = pendingFocusPositionRef.current;
    pendingFocusPositionRef.current = null;
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const cursor =
        pos === 'end' ? ta.value.length : pos === 'start' ? 0 : (pos as number);
      ta.setSelectionRange(cursor, cursor);
    });
  }, [isEditing]);

  // Auto-resize textarea height whenever content or edit mode changes
  useEffect(() => {
    if (!isEditing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [block.content, block.type, isEditing]);

  const filteredNotes = allNotes.filter(
    (n) =>
      n.id !== currentNoteId &&
      (acQuery === '' || n.title.toLowerCase().includes((acQuery ?? '').toLowerCase()))
  );

  const filteredCommands = SLASH_COMMANDS.filter(
    (cmd) =>
      slashQuery === '' ||
      cmd.label.toLowerCase().includes((slashQuery ?? '').toLowerCase()) ||
      cmd.type.toLowerCase().includes((slashQuery ?? '').toLowerCase())
  );

  function enterEditMode(position: 'start' | 'end' = 'end') {
    pendingFocusPositionRef.current = position;
    setIsEditing(true);
  }

  function handleViewClick() {
    enterEditMode('end');
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;

    // Auto-convert markdown shortcuts at start of paragraph (single patch to avoid stale closure)
    if (block.type === 'paragraph') {
      if (val === '* ' || val === '- ') {
        onBlockPatch(block.id, { type: 'bullet', content: '' });
        return;
      }
      if (val === '1. ' || val === '1) ') {
        onBlockPatch(block.id, { type: 'numbered', content: '' });
        return;
      }
      if (val === '[] ' || val === '[ ] ') {
        onBlockPatch(block.id, { type: 'task', content: '', checked: false });
        return;
      }
      if (val === '> ') {
        onBlockPatch(block.id, { type: 'blockquote', content: '' });
        return;
      }
    }

    onContentChange(block.id, val);

    if (val.startsWith('/') && !val.includes('\n')) {
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
      setAcQuery(null);
      return;
    }
    setSlashQuery(null);
    setAcQuery(getWikiLinkQuery(val, cursor));
    setAcIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashQuery !== null && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlashCommand(filteredCommands[slashIndex].type); return; }
      if (e.key === 'Escape') { setSlashQuery(null); return; }
    }

    if (acQuery !== null && filteredNotes.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex((i) => Math.min(i + 1, filteredNotes.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyAutocomplete(filteredNotes[acIndex]); return; }
      if (e.key === 'Escape') { setAcQuery(null); return; }
    }

    const ta = e.currentTarget;

    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') {
      e.preventDefault();
      // Empty list/task/quote block → escape back to paragraph
      if (block.content === '' && (block.type === 'bullet' || block.type === 'numbered' || block.type === 'task' || block.type === 'blockquote')) {
        onBlockPatch(block.id, { type: 'paragraph' });
        return;
      }
      const cursor = ta.selectionStart ?? block.content.length;
      onSplitBlock(block.id, block.content.slice(0, cursor), block.content.slice(cursor));
      return;
    }

    if (e.key === 'Backspace' && block.content === '' && !isFirst) {
      e.preventDefault();
      onDeleteBlock(block.id);
    }
  }

  function applySlashCommand(type: BlockType) {
    const patch: Partial<Block> = { type, content: '' };
    if (type === 'table') patch.tableData = createDefaultTable();
    onBlockPatch(block.id, patch);
    setSlashQuery(null);
    if (type !== 'table') {
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
      });
    }
  }

  function applyAutocomplete(note: NoteMetaResponse) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? block.content.length;
    const { newContent, newCursor } = insertWikiLink(block.content, cursor, note.title);
    onContentChange(block.id, newContent);
    setAcQuery(null);
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
    });
  }

  function handleBlur() {
    setTimeout(() => {
      setIsEditing(false);
      setAcQuery(null);
      setSlashQuery(null);
    }, 150);
  }

  const numIdx = block.type === 'numbered' ? numberedIndexInGroup(allBlocks, blockIndex) : 0;

  // ── Table block (bypasses normal edit/view toggle) ────────────────────────────

  if (block.type === 'table') {
    return (
      <div
        className={`${styles.blockRow} ${isDragOver ? styles.blockRowDragOver : ''}`}
        draggable
        onDragStart={() => onDragStart(blockIndex)}
        onDragOver={(e) => { e.preventDefault(); onDragOver(blockIndex); }}
        onDrop={onDrop}
      >
        <div className={styles.dragHandle} aria-hidden="true">⠿</div>
        <div className={styles.blockPrefix} />
        <div className={styles.blockInputWrapper}>
          {block.tableData && (
            <TableBlock
              block={block}
              onTableChange={(patch) => onBlockPatch(block.id, patch)}
              onDeleteTable={() => onDeleteBlock(block.id)}
              allNotes={allNotes}
              onLinkClick={onLinkClick}
            />
          )}
        </div>
      </div>
    );
  }

  // ── View mode content ────────────────────────────────────────────────────────

  function renderViewContent() {
    if (block.type === 'code') {
      return (
        <pre className={styles.blockViewCode} onClick={handleViewClick}>
          {block.content || <span className={styles.blockPlaceholder}>Code…</span>}
        </pre>
      );
    }

    if (block.type === 'blockquote') {
      return (
        <blockquote className={styles.blockViewQuote} onClick={handleViewClick}>
          {block.content
            ? renderInline(block.content, allNotes, onLinkClick)
            : <span className={styles.blockPlaceholder}>Quote…</span>}
        </blockquote>
      );
    }

    if (!block.content) {
      return (
        <div className={styles.blockView} onClick={handleViewClick}>
          {isFirst && (
            <span className={styles.blockPlaceholder}>
              Start writing… use / for block types, [[ to link notes
            </span>
          )}
        </div>
      );
    }

    // Detect heading prefix on paragraph blocks
    const headingMatch = block.type === 'paragraph'
      ? block.content.match(/^(#{1,3}) (.*)/)
      : null;

    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const inlineContent = renderInline(headingText, allNotes, onLinkClick);
      const headingClass = level === 1
        ? styles.blockViewH1
        : level === 2
        ? styles.blockViewH2
        : styles.blockViewH3;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      return <Tag className={headingClass} onClick={handleViewClick}>{inlineContent}</Tag>;
    }

    const viewClass = block.type === 'task' && block.checked
      ? `${styles.blockView} ${styles.blockViewChecked}`
      : styles.blockView;

    return (
      <div className={viewClass} onClick={handleViewClick}>
        {renderInline(block.content, allNotes, onLinkClick)}
      </div>
    );
  }

  // ── Edit mode content ────────────────────────────────────────────────────────

  const editPlaceholder =
    block.type === 'code'
      ? 'Code…'
      : isFirst
      ? 'Start writing… use / for block types, [[ to link notes'
      : '';

  return (
    <div
      className={`${styles.blockRow} ${isDragOver ? styles.blockRowDragOver : ''}`}
      draggable
      onDragStart={() => onDragStart(blockIndex)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(blockIndex); }}
      onDrop={onDrop}
    >
      <div className={styles.dragHandle} aria-hidden="true">⠿</div>

      <div className={styles.blockPrefix}>
        {block.type === 'bullet' && <span>•</span>}
        {block.type === 'numbered' && <span>{numIdx}.</span>}
        {block.type === 'task' && (
          <input
            type="checkbox"
            className={styles.taskCheckbox}
            checked={!!block.checked}
            onChange={() => onToggleCheck(block.id)}
          />
        )}
      </div>

      <div className={styles.blockInputWrapper}>
        {isEditing ? (
          <>
            <textarea
              ref={taRef}
              className={`${styles.blockTextarea} ${block.type === 'code' ? styles.blockTextareaCode : ''} ${block.type === 'blockquote' ? styles.blockTextareaQuote : ''}`}
              value={block.content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={editPlaceholder}
              rows={1}
              spellCheck={block.type !== 'code'}
              aria-label={`Block ${blockIndex + 1}`}
              autoFocus
            />

            {slashQuery !== null && filteredCommands.length > 0 && (
              <ul className={styles.slashMenu} role="listbox">
                {filteredCommands.map((cmd, i) => (
                  <li
                    key={cmd.type}
                    role="option"
                    aria-selected={i === slashIndex}
                    className={i === slashIndex ? styles.slashItemActive : styles.slashItem}
                    onMouseDown={(e) => { e.preventDefault(); applySlashCommand(cmd.type); }}
                  >
                    <span className={styles.slashLabel}>{cmd.label}</span>
                    <span className={styles.slashDesc}>{cmd.description}</span>
                  </li>
                ))}
              </ul>
            )}

            {acQuery !== null && filteredNotes.length > 0 && (
              <ul className={styles.autocomplete} role="listbox">
                {filteredNotes.slice(0, 8).map((n, i) => (
                  <li
                    key={n.id}
                    role="option"
                    aria-selected={i === acIndex}
                    className={i === acIndex ? styles.acItemActive : styles.acItem}
                    onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(n); }}
                  >
                    {n.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          renderViewContent()
        )}
      </div>
    </div>
  );
}
