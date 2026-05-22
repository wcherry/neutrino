import React from 'react';
import type { NoteMetaResponse } from '@/lib/api';
import type { Block } from './blockEditorTypes';
import { INLINE_PATTERN } from './blockEditorConstants';
import styles from './BlockEditor.module.css';

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

export function renderInline(
  text: string,
  allNotes: NoteMetaResponse[],
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
