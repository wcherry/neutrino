'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteLinkTarget } from './blockEditorHelpers';
import type { Block, BlockRowProps, MarkdownShortcut, SlashCommand } from './blockEditorTypes';
import { SLASH_COMMANDS } from './blockEditorConstants';
import {
  caretColumn,
  createDefaultTable,
  getWikiLinkQuery,
  insertWikiLink,
  isDividerContent,
  isOnFirstLine,
  isOnLastLine,
  isSoftWrapped,
  matchMarkdownShortcut,
  renderInline,
  numberedIndexInGroup,
  toggleHeadingPrefix,
  toggleInlineMarker,
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
  exitEditSignal,
  onContentChange,
  onTypeChange,
  onBlockPatch,
  onToggleCheck,
  onSplitBlock,
  onDeleteBlock,
  onMoveFocus,
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

  // Stores a pending cursor position to apply once the textarea mounts — or a
  // `[start, end]` pair, for the shortcuts below that leave text selected.
  const pendingFocusPositionRef = useRef<'start' | 'end' | number | [number, number] | null>(null);
  // Bumped on every focus request so the effect below re-runs even when this
  // row is already in edit mode (rapid arrow-key navigation back and forth)
  const [focusNonce, setFocusNonce] = useState(0);

  // Handle focus requests from parent (Enter / Backspace merge / arrow keys)
  useEffect(() => {
    if (!focusRequest || focusRequest.id !== block.id) return;
    pendingFocusPositionRef.current = focusRequest.position;
    setIsEditing(true);
    setFocusNonce((n) => n + 1);
    onFocusHandled();
  }, [focusRequest, block.id, onFocusHandled]);

  // Drop out of edit mode immediately (no blur/timeout round-trip) when the
  // parent signals it — used before a whole-note selection, which needs
  // every block rendered as plain, selectable text rather than a <textarea>.
  //
  // Adjusted during render, not in an effect. The caller is `selectAll`, which
  // wraps the signal bump in `flushSync` and then immediately builds a Range
  // over the container — so "immediately" has to mean *before that flushSync
  // returns*. An effect cannot: the `setIsEditing(false)` it schedules is a
  // second render that lands after the flush, so the Range was built while the
  // focused block was still a <textarea>. A textarea's value is not text
  // content, so the whole-note selection came out as just the newlines between
  // the blocks — select-all followed quickly by copy put `"\n\n"` on the
  // clipboard. Re-rendering during render is React's supported way to derive
  // state from a changed prop, and it completes inside the flush.
  const [lastExitSignal, setLastExitSignal] = useState(exitEditSignal);
  if (exitEditSignal !== lastExitSignal) {
    setLastExitSignal(exitEditSignal);
    if (isEditing) {
      setIsEditing(false);
      setAcQuery(null);
      setSlashQuery(null);
    }
  }

  // Once isEditing becomes true, apply any pending cursor position.
  //
  // In a layout effect, not a frame later: the textarea is already focused by
  // `autoFocus` when it mounts, so a caret placed a frame after that is a caret
  // placed *after* whatever was typed in the meantime. Pressing Enter and
  // typing straight into the new block — which is one keystroke, not a pause —
  // moved the caret back to the start mid-word and put the rest of the word in
  // front of it. A layout effect runs in the same commit that mounts the
  // textarea, before the browser can deliver another key event.
  useLayoutEffect(() => {
    if (!isEditing || pendingFocusPositionRef.current === null) return;
    const pos = pendingFocusPositionRef.current;
    pendingFocusPositionRef.current = null;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    if (Array.isArray(pos)) {
      ta.setSelectionRange(pos[0], pos[1]);
      return;
    }
    const cursor =
      pos === 'end' ? ta.value.length : pos === 'start' ? 0 : (pos as number);
    ta.setSelectionRange(cursor, cursor);
  }, [isEditing, focusNonce]);

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

  const slashNeedle = (slashQuery ?? '').toLowerCase();
  const filteredCommands = SLASH_COMMANDS.filter(
    (cmd) =>
      slashNeedle === '' ||
      cmd.label.toLowerCase().includes(slashNeedle) ||
      cmd.id.includes(slashNeedle) ||
      (cmd.keywords ?? []).some((kw) => kw.includes(slashNeedle))
  );

  function enterEditMode(position: 'start' | 'end' = 'end') {
    pendingFocusPositionRef.current = position;
    setIsEditing(true);
  }

  function handleViewClick() {
    // A drag-to-select gesture ends with a native `click` on mouseup too
    // (same target for mousedown and mouseup), which would otherwise
    // immediately blow the just-made selection away by swapping this view
    // for a fresh, collapsed-cursor <textarea>. A plain click without a
    // preceding drag leaves the selection collapsed (mousedown alone already
    // clears/collapses whatever was selected before), so this only skips
    // entering edit mode for the drag-select case.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString() !== '') return;
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
    // Before the menus below: a formatting shortcut means the same thing
    // whether or not one of them happens to be open.
    const shortcut = matchMarkdownShortcut(e);
    if (shortcut && applyMarkdownShortcut(shortcut, e.currentTarget)) {
      e.preventDefault();
      return;
    }

    if (slashQuery !== null && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlashCommand(filteredCommands[slashIndex]); return; }
      if (e.key === 'Escape') { setSlashQuery(null); return; }
    }

    if (acQuery !== null && filteredNotes.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex((i) => Math.min(i + 1, filteredNotes.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyAutocomplete(filteredNotes[acIndex]); return; }
      if (e.key === 'Escape') { setAcQuery(null); return; }
    }

    const ta = e.currentTarget;

    // Arrow up/down at the top/bottom line moves the caret into the adjacent block
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const cursor = ta.selectionStart ?? 0;
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      const atEdge = direction === 'up'
        ? isOnFirstLine(block.content, cursor)
        : isOnLastLine(block.content, cursor);

      if (ta.selectionStart === ta.selectionEnd && atEdge) {
        const column = caretColumn(block.content, cursor);
        if (!isSoftWrapped(ta)) {
          e.preventDefault();
          onMoveFocus(block.id, direction, column);
          return;
        }
        // A line wraps, so the text line the caret is on may span several visual
        // rows. Let the browser move first; if the caret stayed put we were on
        // the first/last visual row after all and should leave the block.
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (!el || el.selectionStart !== cursor || el.selectionEnd !== cursor) return;
          onMoveFocus(block.id, direction, column);
        });
        return;
      }
    }

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

  function applySlashCommand(cmd: SlashCommand) {
    const content = cmd.content ?? '';
    const patch: Partial<Block> = { type: cmd.type, content };
    if (cmd.type === 'table') patch.tableData = createDefaultTable();
    onBlockPatch(block.id, patch);
    setSlashQuery(null);
    // After any markdown the command seeded, so typing carries on where the
    // heading's text or the rule's line would start. (A table has no textarea
    // to put a caret in; `restoreSelection` finds none and does nothing.)
    restoreSelection(content.length, content.length);
  }

  /**
   * Put the caret (or selection) back after a command or shortcut rewrote the
   * content — through the same pending-position handoff a focus request uses,
   * for the same reason its comment gives. The rewrite and this bump are one
   * batched update, so the layout effect sets the caret in that commit, before
   * the browser can deliver the next keystroke. A frame later is too late: a
   * slash command followed straight away by typing (which is what inserting a
   * heading *is*) had the first few characters land at the old caret and the
   * rest at the new one, scrambling the word across two blocks.
   */
  function restoreSelection(start: number, end: number) {
    pendingFocusPositionRef.current = [start, end];
    setFocusNonce((n) => n + 1);
  }

  /**
   * Run a markdown keyboard shortcut against this block. Returns false when it
   * declines — the key press is then left to the browser, rather than being
   * swallowed by a shortcut that did nothing.
   */
  function applyMarkdownShortcut(shortcut: MarkdownShortcut, ta: HTMLTextAreaElement): boolean {
    const start = ta.selectionStart ?? block.content.length;
    const end = ta.selectionEnd ?? start;
    const action = shortcut.action;

    if (action.kind === 'block') {
      // The same shortcut again goes back to a plain paragraph.
      onBlockPatch(block.id, { type: block.type === action.type ? 'paragraph' : action.type });
      restoreSelection(start, end);
      return true;
    }

    if (action.kind === 'heading') {
      // A heading is a paragraph carrying a `#` prefix, so this both switches
      // the type and rewrites the prefix; only the prefix moves the caret.
      const content = toggleHeadingPrefix(block.content, action.level);
      const shift = content.length - block.content.length;
      onBlockPatch(block.id, { type: 'paragraph', content });
      restoreSelection(Math.max(0, start + shift), Math.max(0, end + shift));
      return true;
    }

    // Inline markers inside a code block would be literal asterisks, not
    // formatting — the block renders its content verbatim.
    if (block.type === 'code') return false;

    if (action.kind === 'wikiLink') {
      const selected = block.content.slice(start, end);
      const caret = start + 2 + selected.length;
      onContentChange(
        block.id,
        `${block.content.slice(0, start)}[[${selected}]]${block.content.slice(end)}`
      );
      // Caret between the selected title and the closing brackets, which is
      // where `getWikiLinkQuery` would read the same query from as the user
      // carries on typing.
      setSlashQuery(null);
      setAcQuery(selected);
      setAcIndex(0);
      restoreSelection(caret, caret);
      return true;
    }

    const toggled = toggleInlineMarker(block.content, start, end, action.marker);
    onContentChange(block.id, toggled.content);
    restoreSelection(toggled.selectionStart, toggled.selectionEnd);
    return true;
  }

  function applyAutocomplete(note: NoteLinkTarget) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? block.content.length;
    const { newContent, newCursor } = insertWikiLink(block.content, cursor, note.title);
    onContentChange(block.id, newContent);
    setAcQuery(null);
    restoreSelection(newCursor, newCursor);
  }

  function handleBlur() {
    setTimeout(() => {
      // Focus may have come straight back (arrow key out and back again)
      if (taRef.current && document.activeElement === taRef.current) return;
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
        onDragOver={(e) => { e.preventDefault(); onDragOver(blockIndex); }}
        onDrop={onDrop}
      >
        <div className={styles.dragHandle} aria-hidden="true" draggable onDragStart={() => onDragStart(blockIndex)} />
        <div className={styles.blockPrefix} />
        <div className={styles.blockInputWrapper} data-block-id={block.id}>
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

    // A divider is a paragraph holding nothing but `---`, on the same terms as
    // a heading below: markdown the content itself carries, not a block type.
    if (block.type === 'paragraph' && isDividerContent(block.content)) {
      return (
        <div className={styles.blockViewDivider} onClick={handleViewClick}>
          <hr className={styles.divider} />
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
      onDragOver={(e) => { e.preventDefault(); onDragOver(blockIndex); }}
      onDrop={onDrop}
    >
      <div className={styles.dragHandle} aria-hidden="true" draggable onDragStart={() => onDragStart(blockIndex)} />

      <div className={styles.blockPrefix}>
        {block.type === 'bullet' && <span className={styles.prefixBullet} aria-hidden="true" />}
        {block.type === 'numbered' && <span className={styles.prefixNumber} data-num={numIdx} aria-hidden="true" />}
        {block.type === 'task' && (
          <input
            type="checkbox"
            className={styles.taskCheckbox}
            checked={!!block.checked}
            onChange={() => onToggleCheck(block.id)}
          />
        )}
      </div>

      <div className={styles.blockInputWrapper} data-block-id={block.id}>
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
                    key={cmd.id}
                    role="option"
                    aria-selected={i === slashIndex}
                    className={i === slashIndex ? styles.slashItemActive : styles.slashItem}
                    onMouseDown={(e) => { e.preventDefault(); applySlashCommand(cmd); }}
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
