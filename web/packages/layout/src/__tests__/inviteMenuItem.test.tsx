/**
 * "Invite friends" sits in the account menu in every look: the Flow/Blended
 * `AccountMenu` and the Classic `Topbar` user menu both show it, right after
 * Settings, when given `onInvite`, and leave it out otherwise.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountMenu } from '../shell/ShellMenus';
import { Topbar } from '../Topbar';

const user = { name: 'Ada Lovelace', email: 'ada@example.com' };

function menuItemNames(): string[] {
  return screen.getAllByRole('menuitem').map((el) => el.textContent?.trim() ?? '');
}

describe('AccountMenu — Invite friends', () => {
  function openAccountMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  }

  it('shows "Invite friends" when onInvite is given', () => {
    render(<AccountMenu user={user} onSettings={vi.fn()} onInvite={vi.fn()} />);
    openAccountMenu();

    expect(screen.getByRole('menuitem', { name: 'Invite friends' })).toBeInTheDocument();
  });

  it('calls onInvite when chosen', () => {
    const onInvite = vi.fn();
    render(<AccountMenu user={user} onSettings={vi.fn()} onInvite={onInvite} />);
    openAccountMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Invite friends' }));

    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('places it right after Settings', () => {
    render(
      <AccountMenu
        user={user}
        onProfile={vi.fn()}
        onSettings={vi.fn()}
        onImport={vi.fn()}
        onSignOut={vi.fn()}
        onInvite={vi.fn()}
      />,
    );
    openAccountMenu();

    const names = menuItemNames();
    expect(names.indexOf('Invite friends')).toBe(names.indexOf('Settings') + 1);
  });

  it('leaves it out without onInvite', () => {
    render(<AccountMenu user={user} onSettings={vi.fn()} />);
    openAccountMenu();

    expect(screen.queryByRole('menuitem', { name: 'Invite friends' })).not.toBeInTheDocument();
  });
});

describe('Topbar (Classic) — Invite friends', () => {
  function openUserMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
  }

  it('shows "Invite friends" when onInvite is given', () => {
    render(<Topbar user={user} onSettings={vi.fn()} onInvite={vi.fn()} />);
    openUserMenu();

    expect(screen.getByRole('menuitem', { name: 'Invite friends' })).toBeInTheDocument();
  });

  it('calls onInvite when chosen', () => {
    const onInvite = vi.fn();
    render(<Topbar user={user} onSettings={vi.fn()} onInvite={onInvite} />);
    openUserMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Invite friends' }));

    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('places it right after Settings', () => {
    render(
      <Topbar
        user={user}
        onProfileClick={vi.fn()}
        onSettings={vi.fn()}
        onImport={vi.fn()}
        onSignOut={vi.fn()}
        onInvite={vi.fn()}
      />,
    );
    openUserMenu();

    const names = menuItemNames();
    expect(names.indexOf('Invite friends')).toBe(names.indexOf('Settings') + 1);
  });

  it('leaves it out without onInvite', () => {
    render(<Topbar user={user} onSettings={vi.fn()} />);
    openUserMenu();

    expect(screen.queryByRole('menuitem', { name: 'Invite friends' })).not.toBeInTheDocument();
  });
});
