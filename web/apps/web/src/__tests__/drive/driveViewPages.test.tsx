/**
 * The secondary Drive views — Recent, Starred, Shared with me, Trash and a tag's
 * page (issue #67). They used to hand-roll their own listings; they now render
 * the same `FileGrid` as My Drive, which is what gives them the Large grid /
 * Small grid / Detailed list selector these tests assert on — and, apart from
 * Trash, the same actions (`useFileActions`): read-only on Shared with me,
 * whose files belong to somebody else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@neutrino/ui';
import React from 'react';

const { pushMock, api } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  api: {
    filesystemApi: {
      getRecent: vi.fn(),
      getStarred: vi.fn(),
      listTrash: vi.fn(),
      emptyTrash: vi.fn(),
      restoreFile: vi.fn(),
      restoreFolder: vi.fn(),
      deleteFilePermanently: vi.fn(),
      deleteFolderPermanently: vi.fn(),
      updateFile: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
    },
    sharedWithMeApi: { list: vi.fn() },
    tagsApi: { get: vi.fn(), filesForTag: vi.fn(), rename: vi.fn(), remove: vi.fn() },
    teamsApi: { list: vi.fn(() => Promise.resolve({ teams: [] })) },
    // `fileToGridItem` builds the thumbnail's <img src> from this.
    storageApi: { getThumbnailUrl: vi.fn(() => null), deleteFile: vi.fn(), downloadFile: vi.fn() },
    downloadAndDecryptFile: vi.fn(),
    useUser: () => null,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=tag-1'),
}));

vi.mock('@/lib/api', () => api);

// The preview modal pulls in the download/decrypt stack, which these tests
// don't exercise — only that a non-routable file falls through to it.
vi.mock('../../app/(apps)/drive/PreviewModal', () => ({
  PreviewModal: ({ file }: { file: { name: string } }) => (
    <div data-testid="preview-modal">{file.name}</div>
  ),
}));

import RecentPage from '../../app/(apps)/drive/recent/page';
import StarredPage from '../../app/(apps)/drive/starred/page';
import SharedWithMePage from '../../app/(apps)/drive/shared/page';
import TrashPage from '../../app/(apps)/drive/trash/page';
import TagDetailPage from '../../app/(apps)/drive/tag/page';
import { sortEntries } from '../../app/(apps)/drive/gridItems';

function file(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'f1',
    name: 'report.pdf',
    sizeBytes: 2048,
    mimeType: 'application/pdf',
    folderId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    coverThumbnailUrl: null,
    contentVersion: 1,
    ...overrides,
  };
}

function folder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    name: 'Invoices',
    parentId: null,
    color: null,
    isStarred: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.filesystemApi.getRecent.mockResolvedValue({ files: [file()], folders: [] });
  api.filesystemApi.getStarred.mockResolvedValue({ files: [file()], folders: [folder()] });
  api.sharedWithMeApi.list.mockResolvedValue({ files: [file()], folders: [folder()] });
  api.filesystemApi.listTrash.mockResolvedValue({
    files: [{ id: 'f1', name: 'report.pdf', sizeBytes: 2048, mimeType: 'application/pdf', deletedAt: '2026-03-01T00:00:00Z' }],
    folders: [{ id: 'd1', name: 'Invoices', deletedAt: '2026-03-02T00:00:00Z' }],
  });
});

const PAGES: Array<[string, () => React.ReactElement]> = [
  ['Recent', () => <RecentPage />],
  ['Starred', () => <StarredPage />],
  ['Shared with me', () => <SharedWithMePage />],
  ['Trash', () => <TrashPage />],
];

describe('Drive view pages — view mode selector', () => {
  it.each(PAGES)('%s offers all three view modes', async (_name, page) => {
    renderPage(page());

    const group = await screen.findByRole('group', { name: 'View mode' });
    expect(group).toBeTruthy();
    for (const label of ['Large grid', 'Small grid', 'Detailed list']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it.each(PAGES)('%s switches to the detailed list when the list button is clicked', async (_name, page) => {
    renderPage(page());

    await screen.findByRole('listitem', { name: 'report.pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Detailed list' }));

    // The list view is the only one with column headers.
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Modified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Detailed list' }).getAttribute('aria-pressed')).toBe('true');
  });

  it.each(PAGES)('%s lists its items', async (_name, page) => {
    renderPage(page());
    expect(await screen.findByRole('listitem', { name: 'report.pdf' })).toBeTruthy();
  });
});

describe('Recent page', () => {
  it('opens a file through the shared route dispatch', async () => {
    api.filesystemApi.getRecent.mockResolvedValue({
      files: [file({ id: 'doc1', name: 'Notes', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })],
      folders: [],
    });
    renderPage(<RecentPage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'Notes' }));
    expect(pushMock).toHaveBeenCalledWith('/docs/editor?id=doc1');
  });

  it('falls back to the preview modal for files with no editor', async () => {
    renderPage(<RecentPage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'report.pdf' }));
    // The preview is loaded on first use (`next/dynamic` in useFileActions).
    expect((await screen.findByTestId('preview-modal')).textContent).toBe('report.pdf');
  });

  it('offers Drive’s actions on its files: the star badge and the full menu', async () => {
    renderPage(<RecentPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    // The badge is on the large card; the detailed list marks a star without one.
    fireEvent.click(screen.getByRole('button', { name: 'Large grid' }));
    expect(screen.getByRole('button', { name: 'Add to starred' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('More options for report.pdf'));
    for (const item of ['Share', 'Rename', 'Move to', 'Move to trash']) {
      expect(await screen.findByRole('menuitem', { name: item })).toBeTruthy();
    }
  });
});

describe('Starred page', () => {
  it('lists folders before files', async () => {
    renderPage(<StarredPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    const names = screen.getAllByRole('listitem').map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual(['Invoices', 'report.pdf']);
  });

  it('takes the star off a file from its badge', async () => {
    api.filesystemApi.getStarred.mockResolvedValue({ files: [file({ isStarred: true })], folders: [] });
    api.filesystemApi.updateFile.mockResolvedValue(file());
    renderPage(<StarredPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Large grid' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from starred' }));

    await waitFor(() => expect(api.filesystemApi.updateFile).toHaveBeenCalledWith('f1', { isStarred: false }));
  });

  it('opens a starred folder in My Drive', async () => {
    renderPage(<StarredPage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'Invoices' }));
    expect(pushMock).toHaveBeenCalledWith('/drive?folder=d1');
  });
});

describe('Shared with me page', () => {
  it('offers only what a non-owner can do: no star, and Preview / Copy link / Download', async () => {
    renderPage(<SharedWithMePage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Large grid' }));
    expect(screen.queryByRole('button', { name: 'Add to starred' })).toBeNull();

    fireEvent.click(screen.getByLabelText('More options for report.pdf'));
    const labels = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    expect(labels).toEqual(['Preview', 'Copy link', 'Download']);
  });

  it('leaves a shared folder unopenable, since My Drive lists only the caller’s own', async () => {
    renderPage(<SharedWithMePage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'Invoices' }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('Tag page', () => {
  it('lists the tagged files in the order the sort bar asks for', async () => {
    // The tag endpoint takes no sort parameters, so the page orders the files itself.
    api.tagsApi.get.mockResolvedValue({ id: 'tag-1', name: 'Taxes' });
    api.tagsApi.filesForTag.mockResolvedValue({
      files: [file({ id: 'b', name: 'b.pdf' }), file({ id: 'c', name: 'c.pdf' }), file({ id: 'a', name: 'a.pdf' })],
      total: 3,
    });
    renderPage(<TagDetailPage />);

    await screen.findByRole('listitem', { name: 'a.pdf' });
    const names = () => screen.getAllByRole('listitem').map((el) => el.getAttribute('aria-label'));
    // The tag page's default order is by name, ascending.
    expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);

    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    await waitFor(() => expect(names()).toEqual(['c.pdf', 'b.pdf', 'a.pdf']));
  });
});

describe('Trash page', () => {
  it('restores a file from the row menu', async () => {
    api.filesystemApi.restoreFile.mockResolvedValue(undefined);
    renderPage(<TrashPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    fireEvent.click(screen.getByLabelText('More options for report.pdf'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => expect(api.filesystemApi.restoreFile).toHaveBeenCalledWith('f1'));
  });

  it('restores a folder through the folder endpoint', async () => {
    api.filesystemApi.restoreFolder.mockResolvedValue(undefined);
    renderPage(<TrashPage />);

    await screen.findByRole('listitem', { name: 'Invoices' });
    fireEvent.click(screen.getByLabelText('More options for Invoices'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => expect(api.filesystemApi.restoreFolder).toHaveBeenCalledWith('d1'));
  });

  it('asks for confirmation before deleting forever', async () => {
    api.filesystemApi.deleteFilePermanently.mockResolvedValue(undefined);
    renderPage(<TrashPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    fireEvent.click(screen.getByLabelText('More options for report.pdf'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete forever' }));

    expect(api.filesystemApi.deleteFilePermanently).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => expect(api.filesystemApi.deleteFilePermanently).toHaveBeenCalledWith('f1'));
  });

  it('hides Empty trash once the trash is empty', async () => {
    api.filesystemApi.listTrash.mockResolvedValue({ files: [], folders: [] });
    renderPage(<TrashPage />);

    expect(await screen.findByText('Trash is empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });
});

describe('sortEntries', () => {
  const entries = [
    { name: 'b', sizeBytes: 30, updatedAt: '2026-01-03T00:00:00Z' },
    { name: 'a', sizeBytes: 10, updatedAt: '2026-01-01T00:00:00Z' },
    { name: 'c', sizeBytes: 20, updatedAt: '2026-01-02T00:00:00Z' },
  ];

  it('sorts by name in both directions', () => {
    expect(sortEntries(entries, 'name', 'asc').map((e) => e.name)).toEqual(['a', 'b', 'c']);
    expect(sortEntries(entries, 'name', 'desc').map((e) => e.name)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by size numerically', () => {
    expect(sortEntries(entries, 'size', 'asc').map((e) => e.sizeBytes)).toEqual([10, 20, 30]);
  });

  it('sorts by date chronologically', () => {
    expect(sortEntries(entries, 'updatedAt', 'desc').map((e) => e.name)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input', () => {
    const input = [...entries];
    sortEntries(input, 'name', 'asc');
    expect(input.map((e) => e.name)).toEqual(['b', 'a', 'c']);
  });
});
