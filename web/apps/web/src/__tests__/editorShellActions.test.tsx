import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorShellActions, EditorShellActionsProvider } from '@/components/editorChrome/EditorShellActions';

vi.mock('@neutrino/layout', () => ({
  SearchButton: ({ onOpenPalette }: { onOpenPalette: () => void }) => (
    <button aria-label="Search and commands" onClick={onOpenPalette} />
  ),
  NotificationsMenu: ({ unreadCount }: { unreadCount: number }) => <button>Notifications ({unreadCount})</button>,
  QuickAccessMenu: ({ items }: { items?: unknown[] }) => <button>Quick access ({items?.length ?? 0})</button>,
  AccountMenu: ({ user }: { user: { name: string } }) => <button>Account {user.name}</button>,
}));

const quickAccess = { items: [{ id: 'f1', title: 'Plan', subtitle: 'Edited · Today' }], onOpen: vi.fn() };

describe('EditorShellActions', () => {
  it('draws search, the bell, Quick access and the account menu in the editor frame', async () => {
    const onOpenPalette = vi.fn();
    render(
      <EditorShellActionsProvider
        value={{
          onOpenPalette,
          paletteShortcut: '⌘K',
          notifications: { notifications: [], unreadCount: 2 },
          quickAccess,
          account: { user: { name: 'Pat', email: 'pat@example.test' } },
        }}
      >
        <EditorShellActions />
      </EditorShellActionsProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Search and commands' }));
    expect(onOpenPalette).toHaveBeenCalledOnce();
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    // Quick access sits between the bell and the avatar, as in the top bar.
    expect(names).toEqual(['Search and commands', 'Notifications (2)', 'Quick access (1)', 'Account Pat']);
  });

  it('draws no account menu before the account has loaded', () => {
    render(
      <EditorShellActionsProvider
        value={{ onOpenPalette: vi.fn(), notifications: { notifications: [], unreadCount: 0 }, quickAccess }}
      >
        <EditorShellActions />
      </EditorShellActionsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Search and commands' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications (0)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Account/ })).toBeNull();
  });

  it('draws nothing outside the editor frame, where the top bar has them all', () => {
    const { container } = render(<EditorShellActions />);
    expect(container.innerHTML).toBe('');
  });
});
