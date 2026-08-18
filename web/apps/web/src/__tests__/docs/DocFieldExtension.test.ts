/**
 * Tests for the field node itself, against a real Tiptap editor.
 *
 * Three properties matter here and none of them is visible from the model
 * tests. Typing `{{title}}` has to *become* a field rather than stay as braces.
 * The node has to leave the editor as its value, because `editor.getHTML()` is
 * what export, print and the .docx builder are handed. And the document has to
 * keep holding the code and nothing but the code — a resolved value written
 * back into an attribute would be serialised by the next autosave, which is the
 * whole failure mode the extension exists to avoid.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  DocFieldExtension,
  fieldPosNearSelection,
  pageForElement,
  setDocFieldContext,
} from '@/lib/extensions/DocFieldExtension';
import { emptyDocProperties } from '@/lib/docFields';
import type { EditorView } from '@tiptap/pm/view';

let editor: Editor;

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit, DocFieldExtension] });
  setDocFieldContext(editor, {
    title: 'Quarterly Report',
    pages: 12,
    properties: { ...emptyDocProperties(), author: 'Ada Lovelace' },
  });
});

afterEach(() => {
  editor.destroy();
});

/**
 * Drive one character through the input-rules plugin, as typing does. The rule
 * only fires on the character that completes the token, so tests insert the
 * lead-in and then "type" the final `}`.
 */
function typeChar(char: string): void {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', f =>
    // The last argument is what ProseMirror would have done on its own — the
    // transaction that types the character — which a handler may fall back to.
    f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
  );
  if (!handled) editor.commands.insertContent(char);
}

/** Every field node in the document, in order. */
function fields(): { code: string; arg: string | null; showCode: boolean }[] {
  const found: { code: string; arg: string | null; showCode: boolean }[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'docField') {
      found.push({
        code: node.attrs.code,
        arg: node.attrs.arg,
        showCode: node.attrs.showCode,
      });
    }
  });
  return found;
}

describe('typing a token', () => {
  it('turns {{title}} into a field', () => {
    editor.commands.insertContent('{{title}');
    typeChar('}');
    expect(fields()).toEqual([{ code: 'title', arg: null, showCode: false }]);
    expect(editor.state.doc.textContent).not.toContain('{{');
  });

  it('keeps the fallback from {{author:My Self}}', () => {
    editor.commands.insertContent('{{author:My Self}');
    typeChar('}');
    expect(fields()).toEqual([{ code: 'author', arg: 'My Self', showCode: false }]);
  });

  it('stores {{page-number}} under its canonical code', () => {
    editor.commands.insertContent('{{page-number}');
    typeChar('}');
    expect(fields()[0].code).toBe('page');
  });

  it('leaves surrounding text alone', () => {
    editor.commands.insertContent('Re: {{title}');
    typeChar('}');
    editor.commands.insertContent(' — draft');
    expect(editor.state.doc.textContent).toContain('Re: ');
    expect(editor.state.doc.textContent).toContain(' — draft');
    expect(fields()).toHaveLength(1);
  });

  it('does not fire on something that is not a code', () => {
    editor.commands.insertContent('{{ }');
    typeChar('}');
    expect(fields()).toHaveLength(0);
  });
});

describe('insertDocField', () => {
  it('inserts a field at the caret', () => {
    editor.chain().insertDocField({ code: 'author', arg: 'My Self' }).run();
    expect(fields()).toEqual([{ code: 'author', arg: 'My Self', showCode: false }]);
  });

  it('canonicalises the code it is given', () => {
    editor.chain().insertDocField({ code: 'total-pages' }).run();
    expect(fields()[0].code).toBe('pages');
  });
});

describe('what leaves the editor', () => {
  it('serialises a field as its resolved value', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    expect(editor.getHTML()).toContain('Quarterly Report');
  });

  it('serialises the fallback when the property is empty', () => {
    setDocFieldContext(editor, { properties: emptyDocProperties() });
    editor.chain().insertDocField({ code: 'author', arg: 'My Self' }).run();
    expect(editor.getHTML()).toContain('My Self');
  });

  it('keeps the code in the markup so the field survives a round trip', () => {
    editor.chain().insertDocField({ code: 'author', arg: 'My Self' }).run();
    const html = editor.getHTML();
    expect(html).toContain('data-doc-field="author"');
    expect(html).toContain('data-doc-field-arg="My Self"');

    const reopened = new Editor({ extensions: [StarterKit, DocFieldExtension], content: html });
    const parsed: Record<string, unknown>[] = [];
    reopened.state.doc.descendants(node => {
      if (node.type.name === 'docField') parsed.push(node.attrs);
    });
    expect(parsed).toEqual([{ code: 'author', arg: 'My Self', showCode: false }]);
    reopened.destroy();
  });

  it('contributes its value to the plain-text render', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    expect(editor.getText()).toContain('Quarterly Report');
  });

  it('never writes the resolved value into the document', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('Quarterly Report');
    expect(json).toContain('"code":"title"');
  });
});

describe('a changed context', () => {
  it('changes what the field resolves to, with no edit to the document', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    const before = JSON.stringify(editor.getJSON());

    setDocFieldContext(editor, { title: 'Annual Report' });

    expect(editor.getHTML()).toContain('Annual Report');
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});

describe('toggling between the code and the value', () => {
  it('flips the field the caret is sitting after', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    expect(editor.commands.toggleDocFieldCode()).toBe(true);
    expect(fields()[0].showCode).toBe(true);
    expect(editor.getHTML()).toContain('{{title}}');

    editor.commands.toggleDocFieldCode();
    expect(fields()[0].showCode).toBe(false);
    expect(editor.getHTML()).toContain('Quarterly Report');
  });

  it('does nothing when the caret is not near a field', () => {
    editor.commands.insertContent('plain text');
    expect(editor.commands.toggleDocFieldCode()).toBe(false);
  });

  it('shows all codes without touching any field of its own', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    editor.commands.setAllDocFieldCodes(true);

    // The view shows codes, but no field has been edited — turning it back off
    // must not un-set a field the user had switched to its code by hand.
    expect(fields()[0].showCode).toBe(false);
    expect(editor.view.dom.textContent).toContain('{{title}}');

    editor.commands.setAllDocFieldCodes(false);
    expect(editor.view.dom.textContent).toContain('Quarterly Report');
  });
});

describe('fieldPosNearSelection', () => {
  it('finds the field immediately before the caret', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    const pos = fieldPosNearSelection(editor);
    expect(pos).not.toBeNull();
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('docField');
  });

  it('is null in a document with no fields', () => {
    editor.commands.insertContent('plain text');
    expect(fieldPosNearSelection(editor)).toBeNull();
  });
});

describe('refreshDocFields', () => {
  it('repaints without editing the document', () => {
    editor.chain().insertDocField({ code: 'title' }).run();
    const before = JSON.stringify(editor.getJSON());
    expect(editor.commands.refreshDocFields()).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});

describe('pageForElement', () => {
  // US Letter at 96 dpi with the editor's 0.5in page gap.
  const STRIDE = 1056 + 48;

  /** A view whose root sits at y=0 and whose zoom factor is `scale`. */
  function fakeView(scale = 1): EditorView {
    return {
      dom: {
        getBoundingClientRect: () => ({ top: 0, width: 816 * scale }),
        offsetWidth: 816,
      },
    } as unknown as EditorView;
  }

  function elementAt(top: number): HTMLElement {
    return {
      isConnected: true,
      getBoundingClientRect: () => ({ top }),
    } as unknown as HTMLElement;
  }

  it('counts from 1 at the top of the first page', () => {
    expect(pageForElement(fakeView(), elementAt(0), STRIDE)).toBe(1);
    expect(pageForElement(fakeView(), elementAt(STRIDE - 1), STRIDE)).toBe(1);
  });

  it('steps to the next page on the stride', () => {
    expect(pageForElement(fakeView(), elementAt(STRIDE), STRIDE)).toBe(2);
    expect(pageForElement(fakeView(), elementAt(STRIDE * 4 + 10), STRIDE)).toBe(5);
  });

  it('undoes the zoom transform, so a zoomed page breaks in the same place', () => {
    // At 50% zoom every measured rect is half its layout value; without the
    // correction a field on page 5 would read as page 3.
    expect(pageForElement(fakeView(0.5), elementAt(STRIDE * 4 * 0.5), STRIDE)).toBe(5);
  });

  it('reads as page 1 before the editor has reported a page stride', () => {
    expect(pageForElement(fakeView(), elementAt(5000), 0)).toBe(1);
  });
});
