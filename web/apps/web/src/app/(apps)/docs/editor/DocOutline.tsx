'use client';

import React from 'react';
import type { Editor } from '@tiptap/react';
import styles from './page.module.css';

interface OutlineItem {
  level: number;
  text: string;
  id: string;
}

interface DocOutlineProps {
  editor: Editor | null;
}

function getOutlineItems(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name.startsWith('heading')) {
      const level = node.attrs.level as number;
      const text = node.textContent;
      if (text.trim()) {
        items.push({ level, text, id: `heading-${pos}` });
      }
    }
  });
  return items;
}

function scrollToHeading(editor: Editor, text: string, level: number) {
  editor.state.doc.descendants((node, pos) => {
    if (
      node.type.name.startsWith('heading') &&
      node.attrs.level === level &&
      node.textContent === text
    ) {
      const domNode = editor.view.nodeDOM(pos);
      if (domNode && domNode instanceof HTMLElement) {
        domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return false;
    }
  });
}

const INDENT_CLASS: Record<number, string> = {
  1: '',
  2: styles.outlineItemH2,
  3: styles.outlineItemH3,
  4: styles.outlineItemH4,
};

export function DocOutline({ editor }: DocOutlineProps) {
  if (!editor) return null;

  const items = getOutlineItems(editor);

  return (
    <div className={styles.outlineList}>
      {items.length === 0 ? (
        <div className={styles.outlineEmpty}>
          Add headings to see an outline.
        </div>
      ) : (
        items.map((item, idx) => (
          <button
            key={idx}
            className={`${styles.outlineItem} ${INDENT_CLASS[Math.min(item.level, 4)] ?? styles.outlineItemH4}`}
            onClick={() => scrollToHeading(editor, item.text, item.level)}
            title={item.text}
          >
            {item.text}
          </button>
        ))
      )}
    </div>
  );
}
