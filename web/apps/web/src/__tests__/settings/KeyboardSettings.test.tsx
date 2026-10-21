import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import { KeyboardSettings } from '@/app/(apps)/settings/KeyboardSettings';

// jsdom reports no platform, so chords read the non-Mac way (Ctrl+S).

function row(title: string) {
  return screen.getByText(title, { selector: 'span' }).closest('li')!;
}

function record(title: string, init: KeyboardEventInit) {
  fireEvent.click(screen.getByRole('button', { name: `Add a shortcut for ${title}` }));
  fireEvent.keyDown(screen.getByRole('button', { name: /Press keys/ }), init);
}

beforeEach(() => {
  preferences.reset('keyboard.bindings');
  preferences.reset('keyboard.preset');
});

describe('KeyboardSettings', () => {
  it('lists every command with the keys that run it', () => {
    render(<KeyboardSettings />);
    expect(within(row('Save a version')).getByText('Ctrl+S')).toBeTruthy();
    expect(within(row('Lasso')).getByText('Q')).toBeTruthy();
  });

  it('records a new chord into the synced bindings', () => {
    render(<KeyboardSettings />);
    record('Save a version', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true });
    expect(preferences.get('keyboard.bindings')).toEqual({ 'docs.save': ['Mod+S', 'Mod+Alt+S'] });
    expect(within(row('Save a version')).getByText('Ctrl+Alt+S')).toBeTruthy();
  });

  it('asks before taking a chord another command uses, and unbinds it there', () => {
    render(<KeyboardSettings />);
    record('Save a version', { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toMatch(/Ctrl\+F already runs Find and replace \(Docs\)/);
    expect(preferences.get('keyboard.bindings')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use it here instead' }));
    expect(preferences.get('keyboard.bindings')).toEqual({ 'docs.save': ['Mod+S', 'Mod+F'], 'docs.find': [] });
  });

  it('refuses Escape and Tab', () => {
    render(<KeyboardSettings />);
    record('Lasso', { key: 'Tab', code: 'Tab' });
    expect(screen.getByRole('alert').textContent).toMatch(/reserved/);
    expect(preferences.get('keyboard.bindings')).toBeNull();
  });

  it('removes a chord, resets a command and resets everything', () => {
    render(<KeyboardSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Q from Lasso' }));
    expect(preferences.get('keyboard.bindings')).toEqual({ 'drawing.tool.lasso': [] });
    expect(within(row('Lasso')).getByText('No shortcut')).toBeTruthy();

    fireEvent.click(within(row('Lasso')).getByRole('button', { name: 'Reset' }));
    expect(preferences.get('keyboard.bindings')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Q from Lasso' }));
    fireEvent.click(screen.getByRole('button', { name: /Reset all/ }));
    expect(preferences.get('keyboard.bindings')).toBeNull();
  });

  it('switches preset', () => {
    render(<KeyboardSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'Microsoft 365' }));
    expect(preferences.get('keyboard.preset')).toBe('microsoft');
    expect(within(row('Turn spell check on or off')).getByText('F7')).toBeTruthy();
  });

  it('filters', () => {
    render(<KeyboardSettings />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter shortcuts' }), { target: { value: 'lasso' } });
    expect(screen.queryByText('Save a version')).toBeNull();
    expect(screen.getByText('Lasso')).toBeTruthy();
  });
});
