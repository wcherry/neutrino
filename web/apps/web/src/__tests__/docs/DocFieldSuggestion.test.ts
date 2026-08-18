/**
 * The `{{` autocomplete, against a real editor.
 *
 * The ranking is tested separately; what is tested here is when the menu is
 * open and what happens to the keys while it is. Two of these are the ones that
 * would break silently: the menu has to close as soon as a fallback starts
 * (`{{author:` is no longer a code being typed), and Enter has to fall back to
 * splitting the paragraph the moment the menu is not showing — a suggestion
 * plugin that eats Enter unconditionally breaks typing in the whole document.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { DocFieldExtension, setDocFieldContext } from '@/lib/extensions/DocFieldExtension';
import {
  applySuggestion,
  dispatchSuggestion,
  getFieldSuggestionState,
  isSuggestionOpen,
} from '@/lib/extensions/DocFieldSuggestion';
import { emptyDocProperties } from '@/lib/docFields';

let editor: Editor;

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit, DocFieldExtension] });
  editor.commands.focus();
});

afterEach(() => {
  editor.destroy();
});

const state = () => getFieldSuggestionState(editor.state)!;
const open = () => isSuggestionOpen(getFieldSuggestionState(editor.state));
const codes = () => state().items.map(i => i.code);

/** Press a key through the editor's own keymap, as the browser would. */
function press(key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', f => f(editor.view, event)) === true;
}

function fields(): { code: string }[] {
  const found: { code: string }[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'docField') found.push({ code: node.attrs.code });
  });
  return found;
}

describe('when the menu opens', () => {
  it('lists every code as soon as {{ is typed', () => {
    editor.commands.insertContent('{{');
    expect(open()).toBe(true);
    expect(codes()).toContain('title');
    expect(codes()).toContain('page');
    expect(codes()).toContain('author');
  });

  it('narrows to the matching codes as more is typed', () => {
    editor.commands.insertContent('{{p');
    expect(state().query).toBe('p');
    expect(codes().slice(0, 2)).toEqual(['page', 'pages']);
    expect(codes()).not.toContain('title');
  });

  it('stays shut before the second brace', () => {
    editor.commands.insertContent('{');
    expect(open()).toBe(false);
  });

  it('closes once a fallback starts', () => {
    editor.commands.insertContent('{{author');
    expect(open()).toBe(true);
    editor.commands.insertContent(':');
    expect(open()).toBe(false);
  });

  it('closes when nothing matches', () => {
    editor.commands.insertContent('{{zzz');
    expect(open()).toBe(false);
  });

  it('does not open inside a code block', () => {
    editor.commands.setCodeBlock();
    editor.commands.insertContent('{{');
    expect(open()).toBe(false);
  });

  it('does not open when the caret is elsewhere in the line', () => {
    editor.commands.insertContent('{{ and more');
    expect(open()).toBe(false);
  });

  it("offers the document's own custom properties", () => {
    setDocFieldContext(editor, {
      properties: { ...emptyDocProperties(), custom: { client: 'Initech' } },
    });
    editor.commands.insertContent('{{cl');
    expect(codes()).toEqual(['client']);
  });
});

describe('the keys, while it is open', () => {
  beforeEach(() => {
    editor.commands.insertContent('{{p');
  });

  it('walks the list with the arrows', () => {
    expect(state().index).toBe(0);
    expect(press('ArrowDown')).toBe(true);
    expect(state().index).toBe(1);
    expect(press('ArrowUp')).toBe(true);
    expect(state().index).toBe(0);
  });

  it('wraps at both ends', () => {
    press('ArrowUp');
    expect(state().index).toBe(state().items.length - 1);
    press('ArrowDown');
    expect(state().index).toBe(0);
  });

  it('inserts the highlighted code on Enter, consuming the token', () => {
    expect(press('Enter')).toBe(true);
    expect(fields()).toEqual([{ code: 'page' }]);
    expect(editor.state.doc.textContent).not.toContain('{{');
    expect(open()).toBe(false);
  });

  it('inserts on Tab as well', () => {
    press('ArrowDown');
    expect(press('Tab')).toBe(true);
    expect(fields()).toEqual([{ code: 'pages' }]);
  });

  it('closes on Escape and stays closed while the caret is in the token', () => {
    expect(press('Escape')).toBe(true);
    expect(open()).toBe(false);

    // More of the same token typed: still dismissed, so Escape means "let me
    // finish typing this myself" rather than "hide it for one keystroke".
    editor.commands.insertContent('a');
    expect(open()).toBe(false);
  });

  it('reopens for the next token after a dismissal', () => {
    press('Escape');
    editor.commands.insertContent('age}} and {{t');
    expect(open()).toBe(true);
    expect(codes()).toContain('title');
  });

  it('resets the highlight when the query changes', () => {
    press('ArrowDown');
    expect(state().index).toBe(1);
    editor.commands.insertContent('a');
    expect(state().index).toBe(0);
  });
});

describe('the keys, while it is closed', () => {
  // Asserted by outcome rather than by `press`'s return value: these keys are
  // meant to reach the handler *below* ours, so "handled" stays true — what
  // matters is that the editor did the ordinary thing.
  it('lets Enter split the paragraph as usual', () => {
    editor.commands.insertContent('hello');
    expect(editor.state.doc.childCount).toBe(1);
    press('Enter');
    expect(editor.state.doc.childCount).toBe(2);
    expect(fields()).toEqual([]);
  });

  it('leaves Escape to whatever else wants it', () => {
    editor.commands.insertContent('hello');
    expect(press('Escape')).toBe(false);
  });

  it('leaves an unfinished token alone when Enter is pressed', () => {
    // `{{zzz` matches nothing, so there is no menu and Enter must not swallow
    // the keystroke on the strength of the braces alone.
    editor.commands.insertContent('{{zzz');
    press('Enter');
    expect(editor.state.doc.childCount).toBe(2);
    expect(fields()).toEqual([]);
  });
});

describe('clicking a row', () => {
  it('replaces the token with the field', () => {
    editor.commands.insertContent('Re: {{ti');
    const item = state().items[0];
    expect(applySuggestion(editor.view, editor.schema.nodes.docField, item)).toBe(true);
    expect(fields()).toEqual([{ code: 'title' }]);
    expect(editor.state.doc.textContent).toContain('Re: ');
    expect(editor.state.doc.textContent).not.toContain('{{');
  });

  it('does nothing when no token is open', () => {
    editor.commands.insertContent('plain');
    expect(
      applySuggestion(editor.view, editor.schema.nodes.docField, {
        code: 'title', label: 'Title', hint: '', custom: false,
      }),
    ).toBe(false);
    expect(fields()).toEqual([]);
  });
});

describe('the token being typed', () => {
  it('is decorated while the menu is open, and only then', () => {
    editor.commands.insertContent('{{p');
    expect(state().decorations.find().length).toBe(1);

    dispatchSuggestion(editor.view, { dismiss: true });
    expect(state().decorations.find().length).toBe(0);
  });

  it('spans the braces and the query, so the replacement leaves nothing behind', () => {
    editor.commands.insertContent('{{pa');
    const { from, to } = state();
    expect(editor.state.doc.textBetween(from!, to)).toBe('{{pa');
  });
});
