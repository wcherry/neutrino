/**
 * The status bar's word and character counts. They read zero on every document opened from Drive
 * until the first keystroke, because the stored document is loaded with `setContent(doc, false)`
 * — which emits no `update` event — and the counts only listened for `update`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import { useDocumentCounts } from '@/app/(apps)/docs/editor/useDocumentCounts';

let editor: Editor;

afterEach(() => {
  editor?.destroy();
  vi.useRealTimers();
});

function paragraph(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('useDocumentCounts', () => {
  it('counts a document loaded without an update event', () => {
    vi.useFakeTimers();
    editor = new Editor({ extensions: [StarterKit, CharacterCount] });
    const { result } = renderHook(() => useDocumentCounts(editor));
    expect(result.current).toEqual({ words: 0, characters: 0 });

    // How DocEditor loads the stored document: no `update`, so the load does not autosave.
    act(() => {
      editor.commands.setContent(paragraph('One socket per account'), false);
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toEqual({ words: 4, characters: 22 });
  });

  it('recounts after typing pauses, and ignores selection-only transactions', () => {
    vi.useFakeTimers();
    editor = new Editor({ extensions: [StarterKit, CharacterCount], content: paragraph('Hello') });
    const { result } = renderHook(() => useDocumentCounts(editor));
    expect(result.current.words).toBe(1);

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' world');
      vi.advanceTimersByTime(299);
    });
    expect(result.current.words).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.words).toBe(2);

    const render = vi.fn();
    const { result: again } = renderHook(() => {
      render();
      return useDocumentCounts(editor);
    });
    const renders = render.mock.calls.length;
    act(() => {
      editor.commands.setTextSelection(1);
      vi.advanceTimersByTime(300);
    });
    expect(render.mock.calls.length).toBe(renders);
    expect(again.current.words).toBe(2);
  });
});
