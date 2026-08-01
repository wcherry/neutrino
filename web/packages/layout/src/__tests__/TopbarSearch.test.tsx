import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar, type TopbarSearchResult } from '../Topbar';

const results: TopbarSearchResult[] = [
  {
    id: 'doc-1',
    title: 'Flamingo Budget',
    subtitle: 'Document',
    href: '/docs/editor?id=doc-1',
    modified: 'Mar 3, 2026',
  },
];

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  return render(<Topbar onSearch={vi.fn()} {...props} />);
}

describe('Topbar search', () => {
  it('shows matching results with their last-changed date', async () => {
    const user = userEvent.setup();
    renderTopbar({ searchResults: results });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'flam');

    expect(screen.getByTestId('topbar-search-dropdown')).toBeInTheDocument();
    expect(screen.getByText('Flamingo Budget')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
    expect(screen.getByText('Mar 3, 2026')).toBeInTheDocument();
  });

  it('tells the user when nothing matched instead of staying silent', async () => {
    const user = userEvent.setup();
    renderTopbar({ searchResults: [] });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');

    expect(screen.getByTestId('topbar-search-empty')).toHaveTextContent('No matches');
  });

  it('stays closed until the query reaches the minimum length', async () => {
    const user = userEvent.setup();
    renderTopbar({ searchResults: results });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'fl');

    expect(screen.queryByTestId('topbar-search-dropdown')).not.toBeInTheDocument();
  });

  it('submits the query on Enter and clears the box', async () => {
    const user = userEvent.setup();
    const onSearchSubmit = vi.fn();
    renderTopbar({ searchResults: results, onSearchSubmit });

    const box = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(box, 'flamingo{Enter}');

    expect(onSearchSubmit).toHaveBeenCalledWith('flamingo');
    expect(box).toHaveValue('');
    expect(screen.queryByTestId('topbar-search-dropdown')).not.toBeInTheDocument();
  });

  it('does not submit an empty query', async () => {
    const user = userEvent.setup();
    const onSearchSubmit = vi.fn();
    renderTopbar({ onSearchSubmit });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '   {Enter}');

    expect(onSearchSubmit).not.toHaveBeenCalled();
  });

  it('opens a clicked result', async () => {
    const user = userEvent.setup();
    const onResultClick = vi.fn();
    renderTopbar({ searchResults: results, onResultClick });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'flam');
    await user.click(screen.getByText('Flamingo Budget'));

    expect(onResultClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
  });
});
