import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { resetForTesting } from '@neutrino/commands';
import { CommandPalette, matchCommands, type PaletteCommand } from '../shell/CommandPalette';

const cmd = (id: string, title: string, group = 'Everywhere'): PaletteCommand => ({ id, title, group, run: vi.fn() });

afterEach(() => resetForTesting());

describe('matchCommands', () => {
  const all = [cmd('a', 'Go to Docs'), cmd('b', 'Save a version', 'Docs'), cmd('c', 'Find and replace', 'Docs')];

  it('keeps commands whose title or group has every word, title prefix first', () => {
    expect(matchCommands(all, 'docs').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(matchCommands(all, 'save docs').map((c) => c.id)).toEqual(['b']);
    expect(matchCommands(all, 'replace').map((c) => c.id)).toEqual(['c']);
    expect(matchCommands(all, 'nothing like it')).toEqual([]);
  });
});

describe('CommandPalette', () => {
  it('runs the highlighted command on Enter, moving with the arrow keys, and closes', () => {
    const commands = [cmd('a', 'Go to Docs'), cmd('b', 'Go to Sheets')];
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'go to' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(commands[1].run).toHaveBeenCalledOnce();
    expect(commands[0].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows files once the query is long enough, and opens the one chosen', () => {
    const onResultClick = vi.fn();
    const result = { id: 'f1', title: 'Budget model', subtitle: 'Sheets', href: '/sheets/editor?id=f1' };
    const { rerender } = render(
      <CommandPalette open onClose={() => {}} commands={[]} onSearch={() => {}} searchResults={[result]} onResultClick={onResultClick} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bu' } });
    expect(screen.queryByText('Budget model')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bud' } });
    rerender(<CommandPalette open onClose={() => {}} commands={[]} onSearch={() => {}} searchResults={[result]} onResultClick={onResultClick} />);
    fireEvent.click(screen.getByText('Budget model'));
    expect(onResultClick).toHaveBeenCalledWith(result);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={[cmd('a', 'Go to Docs')]} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
