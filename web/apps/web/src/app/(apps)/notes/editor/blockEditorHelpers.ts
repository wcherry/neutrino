import React from 'react';
import type { Block, MarkdownShortcut } from './blockEditorTypes';
import { DIVIDER_PATTERN, INLINE_PATTERN, MARKDOWN_SHORTCUTS } from './blockEditorConstants';
import styles from './BlockEditor.module.css';

/** The subset of a note's identity the editor needs for wiki-link autocomplete/rendering. */
export interface NoteLinkTarget {
  id: string;
  title: string;
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createDefaultTable() {
  const c1 = genId(); const c2 = genId(); const c3 = genId();
  return {
    columns: [
      { id: c1, width: 160 },
      { id: c2, width: 160 },
      { id: c3, width: 160 },
    ],
    rows: [
      { id: genId(), cells: [{ id: genId(), content: '' }, { id: genId(), content: '' }, { id: genId(), content: '' }] },
      { id: genId(), cells: [{ id: genId(), content: '' }, { id: genId(), content: '' }, { id: genId(), content: '' }] },
      { id: genId(), cells: [{ id: genId(), content: '' }, { id: genId(), content: '' }, { id: genId(), content: '' }] },
    ],
  };
}

export function parseBlocks(content: string): Block[] {
  if (!content.trim()) {
    return [{ id: genId(), type: 'paragraph', content: '' }];
  }
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.type === 'string') {
      return parsed as Block[];
    }
  } catch {}
  // Legacy plain text / markdown: wrap as single paragraph
  return [{ id: genId(), type: 'paragraph', content }];
}

export function serializeBlocks(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

/**
 * Extract all `[[title]]` wiki-link targets across every block's content.
 * Mirrors the server's `parse_wiki_links` (src/notes/service.rs) — content is
 * now encrypted before it reaches the server, so link targets must be
 * extracted here and sent alongside the ciphertext as `linkedTitles`.
 */
export function extractWikiLinkTitles(blocks: Block[]): string[] {
  const titles: string[] = [];
  const pattern = /\[\[([^\]\n]*)\]\]/g;
  for (const block of blocks) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(block.content)) !== null) {
      const title = match[1].trim();
      if (title) titles.push(title);
    }
  }
  return titles;
}

export function getWikiLinkQuery(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  const match = before.match(/\[\[([^\][\n]*)$/);
  return match ? match[1] : null;
}

export function insertWikiLink(
  content: string,
  cursorPos: number,
  noteTitle: string
): { newContent: string; newCursor: number } {
  const before = content.slice(0, cursorPos);
  const after = content.slice(cursorPos);
  const match = before.match(/\[\[([^\][\n]*)$/);
  if (!match) return { newContent: content, newCursor: cursorPos };
  const prefix = before.slice(0, before.length - match[0].length);
  const link = `[[${noteTitle}]]`;
  return { newContent: prefix + link + after, newCursor: prefix.length + link.length };
}

// ── Markdown shortcuts ───────────────────────────────────────────────────────

/** The shortcut this key press asks for, or null if it asks for nothing. */
export function matchMarkdownShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>
): MarkdownShortcut | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  return (
    MARKDOWN_SHORTCUTS.find(
      (s) =>
        !!s.shift === e.shiftKey &&
        !!s.alt === e.altKey &&
        // Either identification is enough — see `MarkdownShortcut` for why
        // neither one alone survives every keyboard layout.
        (s.code === e.code || s.key === key)
    ) ?? null
  );
}

export interface InlineToggle {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Wrap the selection in `marker`, or unwrap it when it is already wrapped —
 * whether the markers are inside the selection (`|**bold**|`) or immediately
 * outside it (`**|bold|**`), since which one you get depends on how the
 * selection was made. With no selection this inserts an empty pair and puts
 * the caret between the two halves, and pressing the shortcut again there
 * takes the pair back out.
 */
export function toggleInlineMarker(
  content: string,
  start: number,
  end: number,
  marker: string
): InlineToggle {
  const m = marker.length;
  const wrappedOutside =
    start >= m && content.slice(start - m, start) === marker && content.slice(end, end + m) === marker;

  if (start === end) {
    if (wrappedOutside) {
      return {
        content: content.slice(0, start - m) + content.slice(start + m),
        selectionStart: start - m,
        selectionEnd: start - m,
      };
    }
    return {
      content: content.slice(0, start) + marker + marker + content.slice(start),
      selectionStart: start + m,
      selectionEnd: start + m,
    };
  }

  const selected = content.slice(start, end);
  if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m);
    return {
      content: content.slice(0, start) + inner + content.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  if (wrappedOutside) {
    return {
      content: content.slice(0, start - m) + selected + content.slice(end + m),
      selectionStart: start - m,
      selectionEnd: end - m,
    };
  }
  return {
    content: content.slice(0, start) + marker + selected + marker + content.slice(end),
    selectionStart: start + m,
    selectionEnd: end + m,
  };
}

/**
 * Set (or, with `level` 0, clear) a paragraph's `#` heading prefix. Asking for
 * the level it already has clears it too, so the same shortcut toggles.
 * Only the prefix changes, so the caret moves by the length difference.
 */
export function toggleHeadingPrefix(content: string, level: number): string {
  const match = content.match(/^(#{1,3}) /);
  const current = match ? match[1].length : 0;
  const body = match ? content.slice(match[0].length) : content;
  if (level === 0 || level === current) return body;
  return `${'#'.repeat(level)} ${body}`;
}

/** True when a paragraph holds nothing but a markdown horizontal rule. */
export function isDividerContent(content: string): boolean {
  return DIVIDER_PATTERN.test(content);
}

// ── Caret helpers (arrow-key navigation between blocks) ──────────────────────

/** Offset of the caret from the start of the line it sits on. */
export function caretColumn(content: string, cursor: number): number {
  if (cursor <= 0) return 0;
  return cursor - (content.lastIndexOf('\n', cursor - 1) + 1);
}

/** True when the caret sits on the first line of `content`. */
export function isOnFirstLine(content: string, cursor: number): boolean {
  if (cursor <= 0) return true;
  return content.lastIndexOf('\n', cursor - 1) === -1;
}

/** True when the caret sits on the last line of `content`. */
export function isOnLastLine(content: string, cursor: number): boolean {
  return content.indexOf('\n', cursor) === -1;
}

/**
 * Absolute caret index for `column` on the first or last line of `content`,
 * clamped to that line's length. Used to keep the caret in roughly the same
 * horizontal spot when moving between blocks.
 */
export function caretIndexForColumn(
  content: string,
  column: number,
  edge: 'first' | 'last'
): number {
  if (edge === 'first') {
    const lineEnd = content.indexOf('\n');
    return Math.min(column, lineEnd === -1 ? content.length : lineEnd);
  }
  const lineStart = content.lastIndexOf('\n') + 1;
  return lineStart + Math.min(column, content.length - lineStart);
}

/**
 * True when the textarea renders more visual rows than it has text lines, i.e.
 * at least one line soft-wraps. Line-based caret checks are exact only while
 * nothing wraps; when something does, the caller defers to the browser's own
 * caret movement instead.
 */
export function isSoftWrapped(ta: HTMLTextAreaElement): boolean {
  const cs = window.getComputedStyle(ta);
  let lineHeight = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    lineHeight = parseFloat(cs.fontSize) * 1.2;
  }
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return false;
  const inner =
    ta.scrollHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const visualRows = Math.max(1, Math.round(inner / lineHeight));
  return visualRows > ta.value.split('\n').length;
}

export function renderInline(
  text: string,
  allNotes: NoteLinkTarget[],
  onLinkClick: (id: string) => void
): React.ReactNode[] {
  const titleToId = new Map(allNotes.map((n) => [n.title.toLowerCase(), n.id]));
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        React.createElement('span', { key: lastIndex, style: { whiteSpace: 'pre-wrap' } },
          text.slice(lastIndex, match.index))
      );
    }
    const full = match[0];
    const key = match.index;

    if (match[1]) {
      // [[Wiki link]]
      const title = full.slice(2, -2);
      const targetId = titleToId.get(title.toLowerCase());
      if (targetId) {
        nodes.push(
          React.createElement('button', { key, className: styles.wikiLink, onClick: () => onLinkClick(targetId) },
            title)
        );
      } else {
        nodes.push(React.createElement('span', { key, className: styles.wikiLinkBroken }, full));
      }
    } else if (match[2]) {
      // `inline code`
      nodes.push(React.createElement('code', { key, className: styles.inlineCode }, full.slice(1, -1)));
    } else if (match[3]) {
      // **bold**
      nodes.push(React.createElement('strong', { key }, full.slice(2, -2)));
    } else if (match[4]) {
      // *italic*
      nodes.push(React.createElement('em', { key }, full.slice(1, -1)));
    } else if (match[5]) {
      // ~~strikethrough~~
      nodes.push(React.createElement('s', { key }, full.slice(2, -2)));
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      React.createElement('span', { key: lastIndex, style: { whiteSpace: 'pre-wrap' } },
        text.slice(lastIndex))
    );
  }

  return nodes;
}

export function numberedIndexInGroup(blocks: Block[], blockIndex: number): number {
  let count = 1;
  for (let i = blockIndex - 1; i >= 0; i--) {
    if (blocks[i].type === 'numbered') count++;
    else break;
  }
  return count;
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Render a single block as Markdown lines — block content is already stored
 * using the same `**bold**` / `[[wiki link]]` markdown-ish syntax shown in
 * the editor, so blocks only need their type-specific prefix. `blocks` and
 * `index` are the block's position in the *full* note, not just whatever
 * subset is being rendered (e.g. a copied selection) — a numbered item's
 * number depends on the unbroken run of numbered blocks before it there.
 */
export function blockToMarkdownLines(block: Block, blocks: Block[], index: number): string[] {
  switch (block.type) {
    case 'bullet':
      return [`- ${block.content}`];
    case 'numbered':
      return [`${numberedIndexInGroup(blocks, index)}. ${block.content}`];
    case 'task':
      return [`- [${block.checked ? 'x' : ' '}] ${block.content}`];
    case 'blockquote':
      return [`> ${block.content}`];
    case 'code':
      return ['```', block.content, '```'];
    case 'table': {
      const rows = block.tableData?.rows ?? [];
      const lines: string[] = [];
      rows.forEach((row, i) => {
        lines.push(`| ${row.cells.map((c) => c.content).join(' | ')} |`);
        if (i === 0) lines.push(`| ${row.cells.map(() => '---').join(' | ')} |`);
      });
      return lines;
    }
    default:
      return [block.content];
  }
}

/** A single block's Markdown, e.g. for copying just that block to the clipboard. */
export function blockToMarkdown(block: Block, blocks: Block[], index: number): string {
  return blockToMarkdownLines(block, blocks, index).join('\n');
}

/** Render a note's blocks as Markdown. */
export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    lines.push(...blockToMarkdownLines(block, blocks, index));
    lines.push('');
  });
  return lines.join('\n').trim() + '\n';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineToHtml(text: string): string {
  return escapeHtml(text).replace(INLINE_PATTERN, (full) => {
    if (full.startsWith('[[')) return `<strong>${full.slice(2, -2)}</strong>`;
    if (full.startsWith('`')) return `<code>${full.slice(1, -1)}</code>`;
    if (full.startsWith('**')) return `<strong>${full.slice(2, -2)}</strong>`;
    if (full.startsWith('~~')) return `<s>${full.slice(2, -2)}</s>`;
    if (full.startsWith('*')) return `<em>${full.slice(1, -1)}</em>`;
    return full;
  });
}

/** Render a note's blocks as printable HTML — used for Print and the HTML export. */
export function blocksToHtml(blocks: Block[]): string {
  const parts: string[] = [];
  let listOpen: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listOpen) { parts.push(`</${listOpen}>`); listOpen = null; }
  };

  for (const block of blocks) {
    if (block.type === 'bullet' || block.type === 'numbered') {
      const tag = block.type === 'bullet' ? 'ul' : 'ol';
      if (listOpen !== tag) { closeList(); parts.push(`<${tag}>`); listOpen = tag; }
      parts.push(`<li>${inlineToHtml(block.content)}</li>`);
      continue;
    }
    closeList();
    switch (block.type) {
      case 'task':
        parts.push(`<p>${block.checked ? '☑' : '☐'} ${inlineToHtml(block.content)}</p>`);
        break;
      case 'blockquote':
        parts.push(`<blockquote>${inlineToHtml(block.content)}</blockquote>`);
        break;
      case 'code':
        parts.push(`<pre><code>${escapeHtml(block.content)}</code></pre>`);
        break;
      case 'table': {
        const rows = block.tableData?.rows ?? [];
        const rowsHtml = rows
          .map((row) => `<tr>${row.cells.map((c) => `<td>${inlineToHtml(c.content)}</td>`).join('')}</tr>`)
          .join('');
        parts.push(`<table>${rowsHtml}</table>`);
        break;
      }
      default: {
        if (isDividerContent(block.content)) { parts.push('<hr>'); break; }
        // A heading is a paragraph carrying its own `#` prefix, exactly as the
        // editor renders one — so print and the HTML export have to read it
        // back out rather than printing the hashes.
        const heading = block.content.match(/^(#{1,3}) (.*)/);
        if (heading) {
          const level = heading[1].length;
          parts.push(`<h${level}>${inlineToHtml(heading[2])}</h${level}>`);
          break;
        }
        parts.push(block.content.trim() ? `<p>${inlineToHtml(block.content)}</p>` : '<p><br></p>');
      }
    }
  }
  closeList();
  return parts.join('\n');
}
