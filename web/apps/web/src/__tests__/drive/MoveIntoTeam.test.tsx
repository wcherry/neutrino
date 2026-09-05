/**
 * Moving a file into a team, from the Move to dialog.
 *
 * A team is a destination, so it is in the destination picker — which is the whole change, and the
 * risk that comes with it: the two destinations in one list do very different things, and only one
 * of them can be undone. So what these pin down is that a team reads as a team on the way in (its
 * own mark, its own folders), that the irreversible confirm is armed only once the browser is
 * inside one, and that a caller who is offered no teams sees the dialog that always existed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getFolderContents = vi.fn();
const listLibrary = vi.fn();

vi.mock('@/lib/api', () => ({
  filesystemApi: { getFolderContents: (...a: unknown[]) => getFolderContents(...a) },
  teamsApi: { listLibrary: (...a: unknown[]) => listLibrary(...a) },
  useUser: () => ({ id: 'u1', email: 'owner@example.com', name: 'Owner' }),
}));

import { MoveFolderDialog } from '@/app/(apps)/drive/MoveFolderDialog';

const TEAM = {
  id: 't1',
  name: 'Marketing',
  avatarColor: '#dc2626',
  avatarEmoji: null,
  archived: false,
  userRole: 'owner',
} as never;

function renderDialog(props: Record<string, unknown> = {}) {
  const onMove = vi.fn();
  const onMoveIntoTeam = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MoveFolderDialog
        itemName="Roadmap.md"
        currentFolderId={null}
        teams={[TEAM]}
        onMove={onMove}
        onMoveIntoTeam={onMoveIntoTeam}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onMove, onMoveIntoTeam, user: userEvent.setup() };
}

describe('MoveFolderDialog with team destinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFolderContents.mockResolvedValue({ folders: [{ id: 'f1', name: 'Attachments' }], files: [] });
    listLibrary.mockResolvedValue({ folders: [{ id: 'tf1', name: 'Campaigns' }], files: [] });
  });

  /**
   * "My Drive" as the only crumb above My Drive's own folders was a label for the thing you were
   * already looking at. The trail starts once there is somewhere to go back to.
   */
  it('shows no breadcrumb at the top level, and both kinds of destination', async () => {
    renderDialog();

    expect(await screen.findByText('Attachments')).toBeTruthy();
    expect(screen.getByText('Marketing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'My Drive' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move here' })).toBeTruthy();
  });

  it('browses into a My Drive folder with a trail rooted at My Drive', async () => {
    const { onMove, user } = renderDialog();

    await user.click(await screen.findByText('Attachments'));
    expect(screen.getByRole('button', { name: 'My Drive' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Move here' }));
    expect(onMove).toHaveBeenCalledWith('f1');
  });

  it('browses a team library and moves into the folder it is looking at', async () => {
    const { onMoveIntoTeam, user } = renderDialog();

    await user.click(await screen.findByText('Marketing'));

    // The team's own listing, not the Drive folder endpoint — a team's folders are team rows.
    await waitFor(() => expect(listLibrary).toHaveBeenCalledWith('t1', undefined));
    expect(await screen.findByText('Campaigns')).toBeTruthy();

    // Inside a team the move gives the file away, so the dialog says so and the button changes.
    expect(screen.getByText('This cannot be undone')).toBeTruthy();

    await user.click(screen.getByText('Campaigns'));
    await waitFor(() => expect(listLibrary).toHaveBeenCalledWith('t1', 'tf1'));
    await user.click(screen.getByRole('button', { name: 'Move into team' }));
    expect(onMoveIntoTeam).toHaveBeenCalledWith('t1', 'tf1');
  });

  it('backs out of a team to the full list of destinations', async () => {
    const { user } = renderDialog();

    await user.click(await screen.findByText('Marketing'));
    expect(screen.getByText('This cannot be undone')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'All destinations' }));
    expect(screen.queryByText('This cannot be undone')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move here' })).toBeTruthy();
  });

  /**
   * What every caller moving a folder or a selection gets: the server moves one *file* into a team
   * and has no route for anything else, so those callers pass no handler and are offered no teams.
   */
  it('offers no teams without a handler for them', async () => {
    renderDialog({ onMoveIntoTeam: undefined });

    expect(await screen.findByText('Attachments')).toBeTruthy();
    expect(screen.queryByText('Marketing')).toBeNull();
  });
});
