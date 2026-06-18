/**
 * Text case transform utilities for the Docs editor.
 *
 * Transforms the selected text in a TipTap editor to a specified case mode.
 * The transformation is applied by dispatching a ProseMirror transaction that
 * replaces each text node within the current selection with the transformed
 * string, preserving all marks (bold, italic, color, etc.) on those nodes.
 *
 * Modes:
 *   uppercase  — ALL CAPS
 *   lowercase  — all lower
 *   title      — Title Case (every word capitalised)
 *   sentence   — Sentence case (first character upper, rest lower)
 */

import type { Editor } from '@tiptap/react';

export type TextCaseMode = 'uppercase' | 'lowercase' | 'title' | 'sentence';

function toTitleCase(text: string): string {
  // Capitalise the first letter of each whitespace-separated word.
  return text.replace(/\S+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

function toSentenceCase(text: string): string {
  // Capitalise the very first character and lowercase the rest.
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

const TRANSFORM_MAP: Record<TextCaseMode, (s: string) => string> = {
  uppercase: (s) => s.toUpperCase(),
  lowercase: (s) => s.toLowerCase(),
  title: toTitleCase,
  sentence: toSentenceCase,
};

/**
 * Apply the given text case transform to the currently selected text.
 *
 * Returns `true` if the selection was non-empty and the transform was applied,
 * `false` otherwise.
 */
export function applyTextCase(editor: Editor, mode: TextCaseMode): boolean {
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;

  const transform = TRANSFORM_MAP[mode];
  const { state } = editor;
  const { tr } = state;
  let offset = 0; // Track position shift as we replace text

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;

    // Clamp to selection boundaries
    const nodeFrom = Math.max(from, pos);
    const nodeTo = Math.min(to, pos + node.nodeSize);
    if (nodeFrom >= nodeTo) return;

    const slice = node.text.slice(nodeFrom - pos, nodeTo - pos);
    const transformed = transform(slice);

    if (slice !== transformed) {
      const adjustedFrom = nodeFrom + offset;
      const adjustedTo = nodeTo + offset;
      tr.insertText(transformed, adjustedFrom, adjustedTo);
      // Adjust offset for any length change (usually 0 for case transforms)
      offset += transformed.length - slice.length;
    }
  });

  if (tr.docChanged) {
    editor.view.dispatch(tr);
    return true;
  }
  return false;
}
