import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar } from '../Topbar';

describe('Topbar search', () => {
  it('is an icon that opens the command palette, not a box of its own', async () => {
    const onOpenPalette = vi.fn();
    render(<Topbar onOpenPalette={onOpenPalette} paletteShortcut="⌘K" />);

    expect(screen.queryByRole('searchbox')).toBeNull();
    const search = screen.getByRole('button', { name: 'Search and commands' });
    expect(search.getAttribute('title')).toBe('Search files, people and commands (⌘K)');
    await userEvent.click(search);
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });

  it('draws no search icon without a palette to open', () => {
    render(<Topbar />);
    expect(screen.queryByRole('button', { name: 'Search and commands' })).toBeNull();
  });
});
