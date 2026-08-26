'use client';

/**
 * FootnoteExtension — custom Tiptap inline node for footnotes.
 *
 * Inserts a superscript footnote marker <sup data-footnote-id="...">N</sup>
 * into the document.  The footnote text is stored in a module-level registry
 * (FootnoteRegistry) rather than inside ProseMirror, because editing nested
 * inline documents would require a full sub-editor setup.
 *
 * The text is *also* a node attribute, and that is where it is persisted. The
 * registry alone is module-scoped and empty on the next page load, so every
 * footnote in a reopened document read back blank — and, once documents became
 * `.docx` (issue #127), there was nothing for the writer to put in
 * `word/footnotes.xml` either. The attribute is the record; the registry is a
 * live cache in front of it, seeded on render and written through on edit.
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
        // The attribute is the record; the registry is a cache that may hold a
        // fresher value from an edit made in this session.
        text: FootnoteRegistry.get(id) ?? (node.attrs.text as string) ?? '',
      });
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

function FootnoteNodeView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const id = node.attrs.id as string;

  // Seed the cache from what was stored, so a footnote opened in a new session
  // shows its text rather than an empty prompt.
  if (!FootnoteRegistry.has(id)) FootnoteRegistry.set(id, (node.attrs.text as string) ?? '');

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
      // Write through to the attribute, which is what autosave persists. This
      // also re-renders, so the no-op transaction that used to force one is
      // no longer needed.
      updateAttributes({ text: newText });
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
      /** The note itself. Persisted here — see the note at the top of the file. */
      text: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-footnote-text') ?? '',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.text ? { 'data-footnote-text': String(attrs.text) } : {},
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
