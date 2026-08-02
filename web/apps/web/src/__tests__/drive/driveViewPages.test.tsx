/**
 * The four secondary Drive views — Recent, Starred, Shared with me and Trash
 * (issue #67). They used to hand-roll their own listings; they now render the
 * same `FileGrid` as My Drive, which is what gives them the Large grid / Small
 * grid / Detailed list selector these tests assert on.
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
      getRootContents: vi.fn(),
      getStarred: vi.fn(),
      listTrash: vi.fn(),
      emptyTrash: vi.fn(),
      restoreFile: vi.fn(),
      restoreFolder: vi.fn(),
      deleteFilePermanently: vi.fn(),
      deleteFolderPermanently: vi.fn(),
    },
    sharedWithMeApi: { list: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api', () => api);

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ officeInPlaceEditing: false }),
}));

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
    coverThumbnail: null,
    coverThumbnailMimeType: null,
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
  api.filesystemApi.getRootContents.mockResolvedValue({ files: [file()], folders: [] });
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
    api.filesystemApi.getRootContents.mockResolvedValue({
      files: [file({ id: 'doc1', name: 'Notes', mimeType: 'application/x-neutrino-doc' })],
      folders: [],
    });
    renderPage(<RecentPage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'Notes' }));
    expect(pushMock).toHaveBeenCalledWith('/docs/editor?id=doc1');
  });

  it('falls back to the preview modal for files with no editor', async () => {
    renderPage(<RecentPage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'report.pdf' }));
    expect(screen.getByTestId('preview-modal').textContent).toBe('report.pdf');
  });
});

describe('Starred page', () => {
  it('lists folders before files', async () => {
    renderPage(<StarredPage />);

    await screen.findByRole('listitem', { name: 'report.pdf' });
    const names = screen.getAllByRole('listitem').map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual(['Invoices', 'report.pdf']);
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
