'use client';

/**
 * TableOfContentsExtension — custom Tiptap block node.
 *
 * Inserts a live Table of Contents block that auto-updates as headings in the
 * document change.  Clicking an entry scrolls to the corresponding heading.
 *
 * The block is atom (non-editable inside ProseMirror) and rendered via a React
 * NodeView.  Because Tiptap re-renders the NodeView on every editor state
 * update, the TOC always reflects the current heading structure.
 */

import React from 'react';
import { Node, mergeAttributes } from '@tiptap/react';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Heading extraction helper
// ---------------------------------------------------------------------------

interface TocEntry {
  level: number;
  text: string;
  pos: number;
}

function getTocEntries(editor: import('@tiptap/react').Editor): TocEntry[] {
  const entries: TocEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      const text = node.textContent;
      if (text.trim()) {
        entries.push({ level, text, pos });
      }
    }
  });
  return entries;
}

const INDENT_CLASSES: Record<number, string> = {
  1: '',
  2: 'toc-h2',
  3: 'toc-h3',
  4: 'toc-h4',
};

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

function TocNodeView({ editor }: ReactNodeViewProps) {
  const entries = getTocEntries(editor);

  const scrollToHeading = (pos: number) => {
    const domNode = editor.view.nodeDOM(pos);
    if (domNode instanceof HTMLElement) {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <NodeViewWrapper data-type="table-of-contents" contentEditable={false}>
      <div className="toc-node">
        <div className="toc-node-title">Table of Contents</div>
        {entries.length === 0 ? (
          <span className="toc-empty">Add headings to generate a Table of Contents.</span>
        ) : (
          entries.map((entry, idx) => (
            <button
              key={idx}
              className={`toc-entry ${INDENT_CLASSES[Math.min(entry.level, 4)] ?? 'toc-h4'}`}
              onClick={() => scrollToHeading(entry.pos)}
              title={entry.text}
            >
              {entry.text}
            </button>
          ))
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const TableOfContentsExtension = Node.create({
  name: 'tableOfContents',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes as Record<string, string>, {
        'data-type': 'table-of-contents',
        class: 'toc-node',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView);
  },
});
