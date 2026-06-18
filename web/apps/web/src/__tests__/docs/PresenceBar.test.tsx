/**
 * Tests for PresenceBar component.
 *
 * Covers:
 * - Returns null when not connected and no users
 * - Shows "You" indicator when connected with no remote users
 * - Renders one avatar per remote user
 * - Avatar shows first letter of user name
 * - Avatar has correct background color from user.color
 * - Avatar has title/tooltip with full user name
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../app/(apps)/docs/editor/PresenceBar.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { PresenceBar } from '../../app/(apps)/docs/editor/PresenceBar';
import type { RemoteUser } from '@/hooks/usePresence';

describe('PresenceBar', () => {
  it('returns null when not connected and no users', () => {
    const { container } = render(<PresenceBar users={[]} connected={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "You" indicator when connected with no remote users', () => {
    render(<PresenceBar users={[]} connected={true} />);
    expect(screen.getByText(/You/)).toBeInTheDocument();
  });

  it('renders one avatar per remote user', () => {
    const users: RemoteUser[] = [
      { clientId: '1', name: 'Alice', color: '#e53935', cursor: null },
      { clientId: '2', name: 'Bob', color: '#1a73e8', cursor: null },
    ];
    render(<PresenceBar users={users} connected={true} />);
    const avatars = screen.getAllByRole('generic').filter(el =>
      el.title === 'Alice' || el.title === 'Bob'
    );
    expect(avatars).toHaveLength(2);
  });

  it('avatar shows first letter of user name', () => {
    const users: RemoteUser[] = [
      { clientId: '1', name: 'Carol', color: '#43a047', cursor: null },
    ];
    render(<PresenceBar users={users} connected={true} />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('avatar has title attribute with full user name', () => {
    const users: RemoteUser[] = [
      { clientId: '1', name: 'Dave', color: '#8e24aa', cursor: null },
    ];
    render(<PresenceBar users={users} connected={true} />);
    const el = screen.getByTitle('Dave');
    expect(el).toBeInTheDocument();
  });

  it('avatar has backgroundColor from user.color', () => {
    const users: RemoteUser[] = [
      { clientId: '1', name: 'Eve', color: '#fb8c00', cursor: null },
    ];
    render(<PresenceBar users={users} connected={true} />);
    const el = screen.getByTitle('Eve');
    expect(el).toHaveStyle({ backgroundColor: '#fb8c00' });
  });
});
