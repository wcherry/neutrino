/**
 * Sharing with a team from the Share dialog.
 *
 * Teams moved in here from a dialog of their own, so what these pin down is the part that only
 * works if the two kinds of grant really share one surface: one box finds both, one button adds
 * whichever was picked, and the access list shows a team grant next to an individual one instead of
 * leaving the file looking unshared while twelve people can open it.
 *
 * The people-only shape is tested too, because it is what every caller without Team Spaces gets and
 * it must be untouched by any of this.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareDialog } from '../components/panels/ShareDialog';
import { ToastProvider } from '../components/feedback/ToastProvider';
import type { ShareDialogProps } from '../components/panels/ShareDialog';

const TEAM = { id: 't1', name: 'Marketing', avatarColor: '#dc2626', avatarEmoji: null };

function renderDialog(props: Partial<ShareDialogProps> = {}) {
  const onAddTeam = vi.fn().mockResolvedValue(undefined);
  const onAddPerson = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <ShareDialog
        resourceName="Roadmap.md"
        onClose={vi.fn()}
        onAddPerson={onAddPerson}
        onSearchUsers={async () => [{ id: 'u2', email: 'ada@example.com', name: 'Ada' }]}
        onSearchTeams={async (q) =>
          TEAM.name.toLowerCase().includes(q.toLowerCase()) ? [TEAM] : []
        }
        onAddTeam={onAddTeam}
        onRoleChange={vi.fn()}
        onRevoke={vi.fn()}
        onCreateLink={vi.fn()}
        onToggleLink={vi.fn()}
        onLinkRoleChange={vi.fn()}
        onLinkVisibilityChange={vi.fn()}
        onLinkExpiryChange={vi.fn()}
        onDeleteLink={vi.fn()}
        {...props}
      />
    </ToastProvider>
  );
  return { onAddTeam, onAddPerson, user: userEvent.setup() };
}

describe('ShareDialog with teams', () => {
  it('finds a team and a person through the same box', async () => {
    const { user } = renderDialog();

    expect(screen.getByText('Add people or team')).toBeTruthy();
    const input = screen.getByLabelText('Email address or team to share with');
    await user.type(input, 'a');

    // Teams first: there are few of them and a team grant is the broader one, so it should not sit
    // below a scrolling list of people who happen to match. Scoped to the picker's own listbox —
    // the role select on the same row is a listbox of options too.
    const picker = await screen.findByRole('listbox');
    const options = within(picker).getAllByRole('option');
    expect(options[0].textContent).toContain('Marketing');
    expect(options.some((o) => o.textContent?.includes('ada@example.com'))).toBe(true);
  });

  it('adds the picked team, at a team role, through the one Add button', async () => {
    const { onAddTeam, onAddPerson, user } = renderDialog();
    const input = screen.getByLabelText('Email address or team to share with');
    await user.type(input, 'Marketing');

    await user.click(await screen.findByRole('option', { name: /Marketing/ }));

    // A team has no `commenter`, so the picker narrows the moment one is chosen.
    const role = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...role.options].map((o) => o.value)).toEqual(['viewer', 'editor']);
    await user.selectOptions(role, 'editor');

    await user.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(onAddTeam).toHaveBeenCalledWith('t1', 'editor'));
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  /**
   * The team stands for itself only while the text is the name that was picked. Typing over it is
   * the way back to inviting a person, and it has to be — the input is the only thing on screen
   * that says which of the two the Add button will do.
   */
  it('unpicks the team when the text is edited', async () => {
    const { onAddTeam, onAddPerson, user } = renderDialog();
    const input = screen.getByLabelText('Email address or team to share with');
    await user.type(input, 'Marketing');
    await user.click(await screen.findByRole('option', { name: /Marketing/ }));

    await user.clear(input);
    await user.type(input, 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /Add/ }));

    await waitFor(() => expect(onAddPerson).toHaveBeenCalledWith('ada@example.com', 'viewer'));
    expect(onAddTeam).not.toHaveBeenCalled();
  });

  it('lists a team beside the people with access, and can end it', async () => {
    const onTeamRevoke = vi.fn();
    const { user } = renderDialog({
      permissions: [
        { id: 'p1', userId: 'u1', role: 'owner', userName: 'William', userEmail: 'w@example.com' },
      ],
      teams: [{ ...TEAM, role: 'viewer' }],
      onTeamRevoke,
    });

    expect(screen.getByText('People and teams with access')).toBeTruthy();
    expect(screen.getByText('Marketing')).toBeTruthy();

    await user.click(screen.getByLabelText('Remove access for Marketing'));
    expect(onTeamRevoke).toHaveBeenCalledWith('t1');
  });

  /** Without both team handlers the dialog is exactly the one that shipped before Team Spaces. */
  it('says nothing about teams when the caller offers none', async () => {
    const { user } = renderDialog({ onSearchTeams: undefined, onAddTeam: undefined });

    expect(screen.getByText('Add people')).toBeTruthy();
    expect(screen.getByText('People with access')).toBeTruthy();

    const input = screen.getByLabelText('Email address to share with');
    await user.type(input, 'a');
    const picker = await screen.findByRole('listbox');
    const options = within(picker).getAllByRole('option');
    expect(options.every((o) => !o.textContent?.includes('Marketing'))).toBe(true);

    const role = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...role.options].map((o) => o.value)).toEqual(['viewer', 'commenter', 'editor']);
  });
});
