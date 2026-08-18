/**
 * The popover half of the `{{` autocomplete.
 *
 * It owns no state of its own — the plugin decides what is open and what is
 * highlighted — so what is worth testing is that it draws what the plugin says,
 * disappears when the plugin closes, and that a click inserts the row that was
 * clicked rather than the row the keyboard was on.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { act } from 'react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { DocFieldExtension } from '@/lib/extensions/DocFieldExtension';
import { FieldSuggestionMenu } from '../../app/(apps)/docs/editor/FieldSuggestionMenu';

let editor: Editor;

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit, DocFieldExtension] });
  // jsdom lays nothing out, so coordsAtPos has no rect to read; the menu only
  // needs somewhere to put itself.
  editor.view.coordsAtPos = () => ({ left: 100, right: 100, top: 200, bottom: 216 });
  editor.commands.focus();
});

afterEach(() => {
  cleanup();
  editor.destroy();
});

/** Type into the editor and let the component's transaction listener run. */
function type(text: string) {
  act(() => {
    editor.commands.insertContent(text);
  });
}

const rows = () => screen.queryAllByRole('option').map(el => el.textContent ?? '');

function fieldCodes(): string[] {
  const found: string[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'docField') found.push(node.attrs.code);
  });
  return found;
}

describe('FieldSuggestionMenu', () => {
  it('draws nothing until a token is being typed', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    expect(screen.queryByRole('listbox')).toBeNull();

    type('hello');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists every code on {{, with its description', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    type('{{');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(rows().length).toBeGreaterThan(5);
    expect(screen.getByText('Page number')).toBeInTheDocument();
    expect(screen.getByText('The number of the page this field is on')).toBeInTheDocument();
    expect(screen.getByText('{{page}}')).toBeInTheDocument();
  });

  it('narrows as more is typed', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    type('{{p');

    expect(rows()[0]).toContain('Page number');
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('marks the highlighted row as selected', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    type('{{p');

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('inserts the row that was clicked, not the highlighted one', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    type('{{p');

    act(() => {
      fireEvent.mouseDown(screen.getAllByRole('option')[1]);
    });

    expect(fieldCodes()).toEqual(['pages']);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes once the token stops being a code', () => {
    render(<FieldSuggestionMenu editor={editor} />);
    type('{{author');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    type(':');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders nothing without an editor', () => {
    render(<FieldSuggestionMenu editor={null} />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
