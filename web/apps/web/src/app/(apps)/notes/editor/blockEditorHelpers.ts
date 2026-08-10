import React from 'react';
import type { Block } from './blockEditorTypes';
import { INLINE_PATTERN } from './blockEditorConstants';
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

/** Render a note's blocks as Markdown — block content is already stored using
 * the same `**bold**` / `[[wiki link]]` markdown-ish syntax shown in the
 * editor, so blocks only need their type-specific prefix. */
export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'bullet':
        lines.push(`- ${block.content}`);
        break;
      case 'numbered':
        lines.push(`${numberedIndexInGroup(blocks, index)}. ${block.content}`);
        break;
      case 'task':
        lines.push(`- [${block.checked ? 'x' : ' '}] ${block.content}`);
        break;
      case 'blockquote':
        lines.push(`> ${block.content}`);
        break;
      case 'code':
        lines.push('```', block.content, '```');
        break;
      case 'table': {
        const rows = block.tableData?.rows ?? [];
        rows.forEach((row, i) => {
          lines.push(`| ${row.cells.map((c) => c.content).join(' | ')} |`);
          if (i === 0) lines.push(`| ${row.cells.map(() => '---').join(' | ')} |`);
        });
        break;
      }
      default:
        lines.push(block.content);
    }
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
      default:
        parts.push(block.content.trim() ? `<p>${inlineToHtml(block.content)}</p>` : '<p><br></p>');
    }
  }
  closeList();
  return parts.join('\n');
}
