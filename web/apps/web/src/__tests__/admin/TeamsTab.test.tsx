/**
 * The admin console's Teams tab (issue #185).
 *
 * The tab answers one question — which team is about to run out of room — and the two things worth
 * pinning down are the two that would be wrong silently: that a team already over its limit is
 * called out by name rather than buried in a list, and that the quota editor sends the bytes it
 * displayed rather than a number the gigabyte conversion mangled on the way through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const listTeams = vi.fn();
const setTeamQuota = vi.fn();
const setTeamOwner = vi.fn();
const setTeamArchived = vi.fn();
const deleteTeam = vi.fn();

vi.mock('@neutrino/api-admin', () => ({
  adminApi: {
    listTeams: (...a: unknown[]) => listTeams(...a),
    setTeamQuota: (...a: unknown[]) => setTeamQuota(...a),
    setTeamOwner: (...a: unknown[]) => setTeamOwner(...a),
    setTeamArchived: (...a: unknown[]) => setTeamArchived(...a),
    deleteTeam: (...a: unknown[]) => deleteTeam(...a),
  },
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div data-testid="spinner" />,
  ProgressBar: ({ value }: { value: number }) => (
    <div role="progressbar" aria-valuenow={value} />
  ),
  Modal: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { TeamsTab } from '@/app/(apps)/admin/TeamsTab';

const GB = 1024 * 1024 * 1024;

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Marketing',
    slug: 'marketing',
    visibility: 'private',
    createdBy: 'u1',
    archived: false,
    owners: [{ userId: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' }],
    memberCount: 4,
    storageUsedBytes: 2 * GB,
    storageLimitBytes: 10 * GB,
    storageRemainingBytes: 8 * GB,
    overQuota: false,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Open a row's actions menu and pick an item.
 *
 * The actions are behind a three-dot button rather than inline, as they are in the Users table, so
 * every one of these tests goes through the menu — which is also what checks the menu is wired to
 * the row it was opened from.
 */
async function chooseAction(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: /^Actions for/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamsTab />
    </QueryClientProvider>
  );
}

describe('TeamsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTeams.mockResolvedValue({ teams: [team()], total: 1 });
  });

  /**
   * The actions are a menu, not four buttons in the cell — a row has four, one of them
   * destructive, and inline they wrap the column and put Delete a mis-click from Archive. Same
   * component as the Users table's row menu.
   */
  it('keeps the row actions behind a three-dot menu', async () => {
    renderTab();

    // Nothing is on the row itself until the menu is opened.
    expect(screen.queryByRole('menuitem')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Marketing' }));

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Storage limit', 'Transfer ownership', 'Archive', 'Delete team']);
  });

  it('names the team’s owner', async () => {
    renderTab();
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });

  /**
   * A team whose last Owner's account was deleted has none, and that is the state the transfer
   * exists to repair — so it has to read as a problem rather than as an empty cell, or it is
   * invisible in exactly the listing meant to surface it.
   */
  it('calls out a team with no owner rather than leaving the cell blank', async () => {
    listTeams.mockResolvedValue({ teams: [team({ owners: [] })], total: 1 });
    renderTab();
    expect(await screen.findByText('No owner')).toBeTruthy();
  });

  it('lists every owner, since the role is not a slot', async () => {
    listTeams.mockResolvedValue({
      teams: [
        team({
          owners: [
            { userId: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' },
            { userId: 'u2', email: 'bo@example.com', name: 'Bo Peep' },
          ],
        }),
      ],
      total: 1,
    });
    renderTab();
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Bo Peep')).toBeTruthy();
  });

  it('shows each team’s usage against its limit', async () => {
    renderTab();
    expect(await screen.findByText('Marketing')).toBeTruthy();
    expect(screen.getByText(/2\.00 GB \/ 10\.00 GB/)).toBeTruthy();
  });

  /**
   * `null` is unlimited, and it must never render as "0 B" — the two are opposites, and a team
   * shown as having no storage is the reading that gets acted on.
   */
  it('renders an unlimited team as unlimited, not as zero', async () => {
    listTeams.mockResolvedValue({
      teams: [team({ storageLimitBytes: null, storageRemainingBytes: null })],
      total: 1,
    });
    renderTab();
    expect(await screen.findByText(/Unlimited/)).toBeTruthy();
    // With no limit there is no percentage to draw a bar of.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  /**
   * A team over its limit is named at the top rather than counted. "Two teams are over their
   * limit" is a number to go and find; a name is a row to click.
   */
  it('names the teams that are over their limit', async () => {
    listTeams.mockResolvedValue({
      teams: [
        team({ overQuota: true, storageUsedBytes: 12 * GB, storageRemainingBytes: 0 }),
        team({ id: 't2', name: 'Design', overQuota: false }),
      ],
      total: 2,
    });
    renderTab();
    const banner = await screen.findByText(/over its storage limit/);
    expect(banner.textContent).toContain('Marketing');
    expect(banner.textContent).not.toContain('Design');
    expect(banner.textContent).toMatch(/Nothing has been deleted/);
  });

  it('sends the limit in bytes, from a figure typed in gigabytes', async () => {
    setTeamQuota.mockResolvedValue(team({ storageLimitBytes: 25 * GB }));
    renderTab();

    await chooseAction('Storage limit');
    const input = screen.getByLabelText('Storage limit (GB)');
    expect((input as HTMLInputElement).value).toBe('10');

    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setTeamQuota).toHaveBeenCalledWith('t1', { storageLimitBytes: 25 * GB })
    );
  });

  /** An empty field is unlimited, not zero — a blank quota means "no limit", not "no storage". */
  it('sends null when the field is cleared', async () => {
    setTeamQuota.mockResolvedValue(team({ storageLimitBytes: null }));
    renderTab();

    await chooseAction('Storage limit');
    fireEvent.change(screen.getByLabelText('Storage limit (GB)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setTeamQuota).toHaveBeenCalledWith('t1', { storageLimitBytes: null })
    );
  });

  /**
   * Lowering a limit past what a team already stores is legitimate and deletes nothing, but an
   * admin who did not mean to should find out before saving rather than from the team.
   */
  it('warns before saving a limit below what the team already stores', async () => {
    renderTab();
    await chooseAction('Storage limit');

    expect(screen.queryByText(/below what Marketing already stores/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Storage limit (GB)'), { target: { value: '1' } });
    expect(screen.getByText(/below what Marketing already stores/)).toBeTruthy();
  });

  /**
   * The transfer says what it costs the current owner before it happens. Discovering afterwards
   * that the person you took the team from was demoted is the outcome this sentence prevents.
   */
  it('warns that transferring demotes the current owner, and sends the email', async () => {
    setTeamOwner.mockResolvedValue(
      team({ owners: [{ userId: 'u2', email: 'bo@example.com', name: 'Bo Peep' }] })
    );
    renderTab();

    await chooseAction('Transfer ownership');
    expect(screen.getByText(/Currently owned by/)).toBeTruthy();
    expect(screen.getByText(/will become an Admin of the team/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/New owner’s email address/), {
      target: { value: ' bo@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() =>
      expect(setTeamOwner).toHaveBeenCalledWith('t1', { email: 'bo@example.com' })
    );
  });

  /**
   * An ownerless team is what the dialog is for, so it says so rather than showing a blank — and
   * the menu item says "Assign", since there is nobody to transfer it from.
   */
  it('says a team has no owner when it has none', async () => {
    listTeams.mockResolvedValue({ teams: [team({ owners: [] })], total: 1 });
    renderTab();

    await chooseAction('Assign an owner');
    expect(screen.getByText(/nobody can change its settings/)).toBeTruthy();
    // Nothing to demote, so nothing about demotion.
    expect(screen.queryByText(/will become an Admin/)).toBeNull();
  });

  /**
   * Archive is sent as the state wanted rather than as a toggle, so a stale row on screen cannot
   * flip the wrong way — and the button says which direction it goes.
   */
  it('archives and restores by sending the state, not a toggle', async () => {
    setTeamArchived.mockResolvedValue(team({ archived: true }));
    renderTab();

    await chooseAction('Archive');
    await waitFor(() =>
      expect(setTeamArchived).toHaveBeenCalledWith('t1', { archived: true })
    );
  });

  it('offers Restore, not Archive, for a team that is already archived', async () => {
    listTeams.mockResolvedValue({ teams: [team({ archived: true })], total: 1 });
    setTeamArchived.mockResolvedValue(team({ archived: false }));
    renderTab();

    await chooseAction('Restore');
    await waitFor(() =>
      expect(setTeamArchived).toHaveBeenCalledWith('t1', { archived: false })
    );
  });

  /**
   * The Delete button sits in a table one row away from Archive, so an accidental click must not be
   * enough. Typing the name is what turns it into a deliberate act.
   */
  it('will not delete until the team’s name is typed back', async () => {
    deleteTeam.mockResolvedValue(undefined);
    renderTab();

    await chooseAction('Delete team');
    expect(
      (screen.getByRole('button', { name: 'Delete team' }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Marketin' } });
    expect(
      (screen.getByRole('button', { name: 'Delete team' }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Marketing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));
    await waitFor(() => expect(deleteTeam).toHaveBeenCalledWith('t1'));
  });

  /** The reversible option is offered in the dialog for the irreversible one. */
  it('points at archiving from the delete dialog', async () => {
    renderTab();
    await chooseAction('Delete team');
    expect(screen.getByText(/archive it instead/)).toBeTruthy();
  });

  it('searches from the server rather than filtering the page it already has', async () => {
    renderTab();
    await screen.findByText('Marketing');

    fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'des' } });

    await waitFor(() =>
      expect(listTeams).toHaveBeenLastCalledWith({ q: 'des', limit: 25, offset: 0 })
    );
  });
});
