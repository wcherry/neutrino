/**
 * The team library, rendered through the standard Drive listing.
 *
 * What is worth pinning down is the part that is easy to half-do: it has to be the *same* grid, so
 * the view selector, the sort bar and the type chips are all there and a team file carries the icon
 * and size a Drive file carries — and the two listings on the page have to stay two, because a lent
 * file is somebody's personal file and folding it into the library would say otherwise.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@neutrino/ui';

const listLibrary = vi.fn();
const listSharedFiles = vi.fn();
const unshareFileFromTeam = vi.fn();

vi.mock('@/lib/api', () => ({
  teamsApi: {
    listLibrary: (...a: unknown[]) => listLibrary(...a),
    listSharedFiles: (...a: unknown[]) => listSharedFiles(...a),
    unshareFileFromTeam: (...a: unknown[]) => unshareFileFromTeam(...a),
    claimFile: vi.fn(),
    createLibraryFolder: vi.fn(),
    trashLibraryFile: vi.fn(),
  },
  authApi: { getProfile: vi.fn() },
  uploadDriveFile: vi.fn(),
  isMissingEncryptionKey: () => false,
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'u1', name: 'Owner' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ teamSpaces: true, teamFileTransfers: true }),
}));

import { FilesView } from '@/app/(apps)/teams/space/FilesView';

const ISO = '2026-01-15T10:00:00Z';

const TEAM = {
  id: 't1',
  name: 'Marketing',
  userRole: 'owner',
  archived: false,
  storageUsedBytes: 2048,
  storageLimitBytes: null,
} as never;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <FilesView team={TEAM} />
      </ToastProvider>
    </QueryClientProvider>
  );
  return userEvent.setup();
}

describe('FilesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLibrary.mockResolvedValue({
      folders: [{ id: 'fol1', name: 'Campaigns', parentId: null, createdAt: ISO, updatedAt: ISO }],
      files: [
        {
          id: 'f1',
          name: 'Roadmap.pdf',
          sizeBytes: 2048,
          mimeType: 'application/pdf',
          folderId: null,
          uploadedBy: 'u1',
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
      storageUsedBytes: 2048,
    });
    listSharedFiles.mockResolvedValue({ files: [], total: 0 });
  });

  it('renders the library through FileGrid, with its chrome and Drive-shaped rows', async () => {
    renderView();

    // Folders first, then files — as on My Drive — and the size formatted the Drive way.
    expect(await screen.findByText('Roadmap.pdf')).toBeTruthy();
    expect(screen.getByText('Campaigns')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();

    // The grid's own controls, which the hand-written list had none of.
    expect(screen.getByRole('group', { name: 'View mode' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Filter files' })).toBeTruthy();
    expect(screen.getByText('Sort:')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  it('opens a folder into the trail and lists it from the server', async () => {
    const user = renderView();

    await user.click(await screen.findByText('Campaigns'));

    await waitFor(() => expect(listLibrary).toHaveBeenCalledWith('t1', 'fol1'));
    // The breadcrumb back to the team root appears only once there is somewhere to go back to.
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy();
  });

  /**
   * The one thing folding the two listings together would destroy: a lent file is not the team's,
   * so it is counted separately, headed separately, and says whose it is.
   */
  it('keeps files lent to the team in their own grid', async () => {
    listSharedFiles.mockResolvedValue({
      files: [
        {
          fileId: 'f9',
          name: 'Budget.xlsx',
          sizeBytes: 1024,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          role: 'editor',
          sharedBy: 'u2',
          sharedByName: 'Ada',
          sharedAt: ISO,
        },
      ],
      total: 1,
    });
    renderView();

    expect(await screen.findByText('Shared with this team')).toBeTruthy();
    expect(screen.getByText('Budget.xlsx')).toBeTruthy();
    // Whose it is and what the team may do with it — the whole difference, in the subtitle.
    expect(screen.getByText('Ada · can edit')).toBeTruthy();

    // Counted apart from the library's two, not added to them.
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getByText('1 items')).toBeTruthy();
  });

  it('offers Stop sharing on a lent file, and Move to trash on the team’s own', async () => {
    listSharedFiles.mockResolvedValue({
      files: [
        {
          fileId: 'f9',
          name: 'Budget.xlsx',
          sizeBytes: 1024,
          mimeType: 'text/plain',
          role: 'viewer',
          sharedBy: 'u2',
          sharedByName: 'Ada',
          sharedAt: ISO,
        },
      ],
      total: 1,
    });
    const user = renderView();

    await user.click(await screen.findByLabelText('More options for Roadmap.pdf'));
    expect(await screen.findByRole('menuitem', { name: /Move to trash/ })).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByLabelText('More options for Budget.xlsx'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Stop sharing/ }));
    expect(unshareFileFromTeam).toHaveBeenCalledWith('t1', 'f9');
  });
});
