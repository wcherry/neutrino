'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Word and character counts, recounted once typing pauses rather than on every render.
 *
 * Driven by every transaction that changes the document, not by Tiptap's `update` event: the
 * stored document is loaded with `setContent(doc, false)`, which emits no `update` (that is what
 * keeps the load from autosaving), so a count listening for `update` stayed at 0 until the first
 * keystroke. Collaborators' edits arrive the same way.
 */
export function useDocumentCounts(editor: Editor | null): { words: number; characters: number } {
  const [counts, setCounts] = useState({ words: 0, characters: 0 });
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const count = () => {
      timer = null;
      if (editor.isDestroyed) return;
      const storage = editor.storage.characterCount;
      setCounts({ words: storage.words(), characters: storage.characters() });
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(count, 300);
    };
    count();
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);
  return counts;
}
