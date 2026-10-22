import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import {
  addKeyHandler,
  availableCommands,
  pushLayer,
  runCommandById,
  registerCommand,
  resetForTesting,
  setPlatformForTesting,
} from '../dispatcher';
import { useCommand, useCommands, useDismiss } from '../react';

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  resetForTesting();
  setPlatformForTesting('mac');
  preferences.reset('keyboard.bindings');
  preferences.reset('keyboard.preset');
});

afterEach(() => {
  resetForTesting();
  setPlatformForTesting(null);
  document.body.innerHTML = '';
});

describe('commands', () => {
  it('runs the command bound to the chord and prevents the default', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    const e = press('s', { metaKey: true });
    expect(save).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it('still accepts Ctrl on a Mac, as every shortcut did before', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    press('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledOnce();
  });

  it('runs only the most recently registered handler for a command', () => {
    const page = vi.fn();
    const dialog = vi.fn();
    registerCommand('docs.save', page);
    registerCommand('docs.save', dialog);
    press('s', { metaKey: true });
    expect(dialog).toHaveBeenCalledOnce();
    expect(page).not.toHaveBeenCalled();
  });

  it('passes over a disabled or declining handler to the next one', () => {
    const below = vi.fn();
    registerCommand('docs.save', below);
    registerCommand('docs.save', () => false);
    registerCommand('docs.save', vi.fn(), { enabled: () => false });
    press('s', { metaKey: true });
    expect(below).toHaveBeenCalledOnce();
  });

  it('follows the user’s bindings, and a binding change takes effect at once', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    preferences.set('keyboard.bindings', { 'docs.save': ['Mod+Alt+S'] });
    press('s', { metaKey: true });
    expect(save).not.toHaveBeenCalled();
    press('ß', { metaKey: true, altKey: true, code: 'KeyS' });
    expect(save).toHaveBeenCalledOnce();
  });

  it('follows the preset', () => {
    const toggle = vi.fn();
    registerCommand('editors.spellCheck.toggle', toggle);
    preferences.set('keyboard.preset', 'microsoft');
    press('F7');
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('skips a command not meant for text fields while one has focus', () => {
    const undo = vi.fn();
    registerCommand('sheets.undo', undo);
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('z', { metaKey: true }, input);
    expect(undo).not.toHaveBeenCalled();
    press('z', { metaKey: true });
    expect(undo).toHaveBeenCalledOnce();
  });

  it('never runs a bare-key binding while typing, whatever the command allows', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    preferences.set('keyboard.bindings', { 'docs.save': ['S'] });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    press('s', {}, editable);
    expect(save).not.toHaveBeenCalled();
  });

  it('can leave the default alone, for copy and paste', () => {
    registerCommand('sheets.copy', vi.fn(), { preventDefault: false });
    expect(press('c', { metaKey: true }).defaultPrevented).toBe(false);
  });

  it('runs a capture-phase command before the focused element sees the key', () => {
    const order: string[] = [];
    registerCommand('docs.insertLink', () => { order.push('command'); }, { phase: 'capture', stopPropagation: true });
    const el = document.createElement('div');
    el.addEventListener('keydown', () => order.push('element'));
    document.body.appendChild(el);
    press('k', { metaKey: true }, el);
    expect(order).toEqual(['command']);
  });

  it('lets the focused element stop a key before a bubble-phase command sees it', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    const el = document.createElement('input');
    el.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(el);
    press('s', { metaKey: true }, el);
    expect(save).not.toHaveBeenCalled();
  });

  it('ignores keys pressed while composing text', () => {
    const save = vi.fn();
    registerCommand('docs.save', save);
    press('s', { metaKey: true, isComposing: true });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('layers', () => {
  it('closes only the topmost layer on Escape', () => {
    const menu = vi.fn();
    const dialog = vi.fn();
    pushLayer(menu);
    pushLayer(dialog);
    press('Escape');
    expect(dialog).toHaveBeenCalledOnce();
    expect(menu).not.toHaveBeenCalled();
  });

  it('passes over a layer that stands aside while typing', () => {
    const page = vi.fn();
    const deselect = vi.fn();
    pushLayer(page);
    pushLayer(deselect, { whileTyping: false });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('Escape', {}, input);
    expect(deselect).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledOnce();
  });

  it('puts a layer on top when it opens, not when it mounts', () => {
    function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
      useDismiss(onClose, open);
      return null;
    }
    const first = vi.fn();
    const second = vi.fn();
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Menu open={open} onClose={first} />
          <Menu open onClose={second} />
          <button onClick={() => setOpen(true)}>open</button>
        </>
      );
    }
    const { getByText } = render(<Page />);
    fireEvent.click(getByText('open'));
    press('Escape');
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});

describe('key handlers', () => {
  it('run in mount order when no layer or command took the key', () => {
    const order: number[] = [];
    addKeyHandler('keydown', () => order.push(1));
    addKeyHandler('keydown', () => order.push(2));
    press('ArrowDown');
    expect(order).toEqual([1, 2]);
  });

  it('do not see a key a command took', () => {
    const handler = vi.fn();
    addKeyHandler('keydown', handler);
    registerCommand('docs.save', vi.fn());
    press('s', { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('see keyup', () => {
    const handler = vi.fn();
    addKeyHandler('keyup', handler);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('useCommand', () => {
  it('calls the latest handler and unregisters on unmount', () => {
    const calls: number[] = [];
    function Saver({ n }: { n: number }) {
      useCommand('docs.save', () => { calls.push(n); });
      return null;
    }
    const { rerender, unmount } = render(<Saver n={1} />);
    rerender(<Saver n={2} />);
    act(() => { press('s', { metaKey: true }); });
    unmount();
    act(() => { press('s', { metaKey: true }); });
    expect(calls).toEqual([2]);
  });
});

describe('useCommands', () => {
  it('counts a handler that returns nothing as having run', () => {
    const select = vi.fn();
    function Page() {
      useCommands({ 'notes.selectAll': () => { select(); } });
      return null;
    }
    render(<Page />);
    let e!: KeyboardEvent;
    act(() => { e = press('a', { metaKey: true }); });
    expect(select).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('the command palette\'s view', () => {
  it('lists the commands that could run now, once each, without key-only ones', () => {
    registerCommand('docs.save', () => {});
    registerCommand('docs.find', () => {}, { enabled: () => false });
    registerCommand('sheets.copy', () => {});
    registerCommand('docs.save', () => {});
    expect(availableCommands()).toEqual(['docs.save']);
  });

  it('runs a command by id through the same handler a key would, skipping ones that decline', () => {
    const outer = vi.fn();
    const inner = vi.fn(() => false);
    registerCommand('shell.goto.docs', outer);
    registerCommand('shell.goto.docs', inner);
    expect(runCommandById('shell.goto.docs')).toBe(true);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
    expect(runCommandById('shell.goto.sheets')).toBe(false);
  });

  it("gives ⌘K to Docs' link command inside Docs and to the palette everywhere else", () => {
    const palette = vi.fn();
    const link = vi.fn();
    registerCommand('shell.commandPalette', palette);
    press('k', { metaKey: true });
    expect(palette).toHaveBeenCalledOnce();
    const off = registerCommand('docs.insertLink', link, { phase: 'capture' });
    press('k', { metaKey: true });
    expect(link).toHaveBeenCalledOnce();
    expect(palette).toHaveBeenCalledOnce();
    // ⌘/ still opens the palette inside Docs.
    press('/', { metaKey: true });
    expect(palette).toHaveBeenCalledTimes(2);
    off();
  });
});
