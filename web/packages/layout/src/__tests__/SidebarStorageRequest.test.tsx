import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppShell } from '../AppShell';
import { Sidebar } from '../Sidebar';

/** `Sidebar` reads the collapsed state off the shell, so it renders inside one. */
function renderSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return render(<AppShell sidebar={<Sidebar {...props} />}>{null}</AppShell>);
}

const QUOTA = { usedBytes: 900_000_000, totalBytes: 1_000_000_000 };

/**
 * The storage meter used to end in a "Manage" link to /settings/storage — a
 * page that does not exist, so the link went nowhere (issue #144). What someone
 * who has run out of room wants is more room, so it asks for it instead.
 */
describe('Sidebar storage request', () => {
  it('offers to ask for more storage', () => {
    const onRequestStorage = vi.fn();
    renderSidebar({ quota: QUOTA, onRequestStorage });

    fireEvent.click(screen.getByRole('button', { name: /request additional/i }));

    expect(onRequestStorage).toHaveBeenCalledTimes(1);
  });

  /**
   * `@neutrino/layout` has no API dependencies, so the ask itself belongs to
   * the embedder. Without one there is nothing to offer, and offering a control
   * that does nothing is what the old link did.
   */
  it('offers nothing when the embedder has no way to ask', () => {
    renderSidebar({ quota: QUOTA });

    expect(screen.queryByRole('button', { name: /request additional/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
  });

  it('still reports what is used against what is allowed', () => {
    renderSidebar({ quota: QUOTA, onRequestStorage: vi.fn() });

    expect(screen.getByText(/of/)).toHaveTextContent('858.3 MB of 953.7 MB used');
  });
});
