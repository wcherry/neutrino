'use client';

/**
 * The `{{` autocomplete for the document body.
 *
 * Deliberately inert: which token is open, which codes match it and which row
 * is highlighted are all decided by the ProseMirror plugin
 * (`DocFieldSuggestion`), because the caret never leaves the document and so
 * the arrow keys and Enter are answered there. All this does is read that state
 * and hand it to `FieldSuggestionList`.
 *
 * It anchors to the token rather than the caret, so the menu stays put as the
 * query is typed instead of creeping right one character at a time.
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  applySuggestion,
  fieldSuggestionKey,
  isSuggestionOpen,
  type FieldSuggestionState,
} from '@/lib/extensions/DocFieldSuggestion';
import { DOC_FIELD_NAME } from '@/lib/extensions/DocFieldExtension';
import { FieldSuggestionList, type SuggestionAnchor } from './FieldSuggestionList';

export interface FieldSuggestionMenuProps {
  editor: Editor | null;
}

export function FieldSuggestionMenu({ editor }: FieldSuggestionMenuProps) {
  const [state, setState] = useState<FieldSuggestionState | null>(null);
  const [anchor, setAnchor] = useState<SuggestionAnchor | null>(null);

  // Every transaction, including the meta-only ones that move the highlight.
  useEffect(() => {
    if (!editor) return;
    const read = () => setState(fieldSuggestionKey.getState(editor.state) ?? null);
    read();
    editor.on('transaction', read);
    return () => {
      editor.off('transaction', read);
    };
  }, [editor]);

  const open = isSuggestionOpen(state ?? undefined) && !!editor;

  const reposition = useCallback(() => {
    if (!editor || !state || state.from === null) return;
    try {
      const coords = editor.view.coordsAtPos(state.from);
      setAnchor({ left: coords.left, top: coords.top, bottom: coords.bottom });
    } catch {
      // The position can be momentarily out of range between a document change
      // and the transaction that recomputes the token.
    }
  }, [editor, state]);

  // Before paint, so the menu never shows for a frame at the previous token's
  // position — which reads as the menu jumping across the page.
  useLayoutEffect(() => {
    if (open) reposition();
    else setAnchor(null);
  }, [open, reposition]);

  // Scrolling and resizing move the token without producing a transaction.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  if (!open || !editor || !state) return null;

  return (
    <FieldSuggestionList
      items={state.items}
      index={state.index}
      anchor={anchor}
      onPick={item => applySuggestion(editor.view, editor.schema.nodes[DOC_FIELD_NAME], item)}
    />
  );
}
