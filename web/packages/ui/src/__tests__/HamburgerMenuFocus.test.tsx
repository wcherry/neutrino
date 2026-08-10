import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HamburgerMenu, type HamburgerMenuItem } from '../components/navigation/HamburgerMenu';

// Consumers (the notes editor in particular — see MenuBar.tsx there) rely on
// Cut/Copy/Paste/Undo/Redo/Select-all still applying to whatever text field
// the user had focused *before* opening the menu: those all resolve to
// `document.execCommand(...)` or `document.activeElement`, which only work
// against a field that is still focused (and, for a plain <textarea> that
// toggles in and out of existence, still mounted) when the action runs.
//
// A real browser focuses a clicked <button> on mousedown, before the click
// even fires, which would blur that field. jsdom does not simulate this
// default action, so a test can't observe the focus surviving end-to-end —
// what it *can* observe is our own contract: the mousedown handler calls
// `preventDefault()`, which is what suppresses that browser default in a
// real DOM.
describe('HamburgerMenu — suppresses the default mousedown focus shift', () => {
  function dispatchMouseDown(el: Element): MouseEvent {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(el, event);
    return event;
  }

  it('prevents default on the trigger button', () => {
    render(<HamburgerMenu items={[{ kind: 'action', label: 'Copy', action: () => {} }]} />);
    const event = dispatchMouseDown(screen.getByLabelText('Open menu'));
    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents default on a menu item button', () => {
    render(<HamburgerMenu items={[{ kind: 'action', label: 'Copy', action: () => {} }]} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const itemButton = screen.getByText('Copy').closest('button')!;
    const event = dispatchMouseDown(itemButton);
    expect(event.defaultPrevented).toBe(true);
  });

  it('still runs the action and closes the menu on click', () => {
    let ran = false;
    render(<HamburgerMenu items={[{ kind: 'action', label: 'Copy', action: () => { ran = true; } }]} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByText('Copy'));
    expect(ran).toBe(true);
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
  });
});
