'use client';

/**
 * FootnoteExtension — custom Tiptap inline node for footnotes.
 *
 * Inserts a superscript footnote marker <sup data-footnote-id="...">N</sup>
 * into the document.  The footnote text is stored in a module-level registry
 * (FootnoteRegistry) rather than inside ProseMirror, because editing nested
 * inline documents would require a full sub-editor setup.
 *
 * Usage:
 *   editor.chain().focus().insertContent({ type: 'footnote', attrs: { id: uuid(), text: 'Note text' } }).run()
 *
 * TODO: Replace window.prompt text editing with an inline floating editor for
 *       a richer authoring experience.
 */

import React from 'react';
import { Node, mergeAttributes } from '@tiptap/react';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Footnote text registry — module-scoped so all node views share it.
// ---------------------------------------------------------------------------

/** Maps footnote id -> footnote text */
export const FootnoteRegistry = new Map<string, string>();

export interface FootnoteItem {
  id: string;
  number: number;
  text: string;
}

/**
 * Walk the editor document in order and return all footnotes with sequential
 * numbers assigned by position.
 */
export function getFootnoteItems(editor: import('@tiptap/react').Editor): FootnoteItem[] {
  const items: FootnoteItem[] = [];
  let counter = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'footnote') {
      counter++;
      const id = node.attrs.id as string;
      items.push({
        id,
        number: counter,
        text: FootnoteRegistry.get(id) ?? '',
      });
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

function FootnoteNodeView({ node, editor }: ReactNodeViewProps) {
  const id = node.attrs.id as string;

  // Compute the sequential number for this node by walking the doc.
  let number = 1;
  let found = false;
  let counter = 0;
  editor.state.doc.descendants((n) => {
    if (found) return false;
    if (n.type.name === 'footnote') {
      counter++;
      if (n.attrs.id === id) {
        number = counter;
        found = true;
        return false;
      }
    }
  });

  const handleClick = () => {
    const el = document.getElementById(`footnote-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = FootnoteRegistry.get(id) ?? '';
    // TODO: replace with an inline floating editor for richer UX.
    const newText = window.prompt('Edit footnote text:', existing);
    if (newText !== null) {
      FootnoteRegistry.set(id, newText);
      // Force a re-render by triggering a no-op transaction.
      editor.view.dispatch(editor.state.tr.setMeta('footnote-edit', id));
    }
  };

  return (
    <NodeViewWrapper as="span" data-type="footnote" style={{ display: 'inline' }}>
      <sup
        className="footnote-marker"
        data-footnote-id={id}
        onClick={handleClick}
        onDoubleClick={handleEdit}
        title="Click to jump to footnote. Double-click to edit."
        style={{ cursor: 'pointer' }}
      >
        {number}
      </sup>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const FootnoteExtension = Node.create({
  name: 'footnote',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-footnote-id'),
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-footnote-id': attrs.id,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-id]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes as Record<string, string>, {
        class: 'footnote-marker',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteNodeView);
  },
});
