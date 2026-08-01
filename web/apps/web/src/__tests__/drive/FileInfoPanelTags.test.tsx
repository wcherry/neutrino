/**
 * Unit tests for the Tags section of the Drive file info panel.
 *
 * Covers:
 *   - Renders the file's tags as chips
 *   - Removing a chip calls removeFromFile and drops it optimistically
 *   - A failed removal restores the chip and explains why
 *   - `focusTags` opens the panel with the picker already expanded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { FileItem, Tag } from '@neutrino/api-drive';

const toastError = vi.fn();

vi.mock('@neutrino/ui', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/ui')>('@neutrino/ui');
  return {
    ...actual,
    useToast: () => ({
      error: toastError,
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

const tagsApi = {
  list: vi.fn(),
  forFile: vi.fn(),
  addToFile: vi.fn(),
  removeFromFile: vi.fn(),
  create: vi.fn(),
};
const storageApi = { listVersions: vi.fn() };

vi.mock('@/lib/api', () => ({
  get tagsApi() {
    return tagsApi;
  },
  get storageApi() {
    return storageApi;
  },
}));

import { FileInfoPanel } from '../../app/(apps)/drive/FileInfoPanel';

const FILE: FileItem = {
  id: 'file-1',
  name: 'return.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  folderId: null,
  isStarred: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  coverThumbnail: null,
  coverThumbnailMimeType: null,
  contentVersion: 1,
};

function tag(id: string, name: string): Tag {
  return { id, name, fileCount: 1, createdAt: '2026-01-01T00:00:00' };
}

function renderPanel(focusTags = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FileInfoPanel file={FILE} onClose={vi.fn()} focusTags={focusTags} />
    </QueryClientProvider>,
  );
}

/** Server-side tag state, so a refetch after a write reflects the write. */
let serverTags: Tag[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  serverTags = [tag('t1', 'taxes'), tag('t2', 'archive')];
  storageApi.listVersions.mockResolvedValue({ versions: [], total: 0 });
  tagsApi.forFile.mockImplementation(async () => [...serverTags]);
  tagsApi.list.mockResolvedValue({ tags: [tag('t1', 'taxes')], total: 1 });
  tagsApi.removeFromFile.mockImplementation(async (_fileId: string, tagId: string) => {
    serverTags = serverTags.filter((t) => t.id !== tagId);
  });
});

describe('FileInfoPanel tags', () => {
  it("renders the file's tags", async () => {
    renderPanel();

    expect(await screen.findByText('taxes')).toBeTruthy();
    expect(screen.getByText('archive')).toBeTruthy();
    expect(tagsApi.forFile).toHaveBeenCalledWith('file-1');
  });

  it('removes a tag', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Remove tag taxes'));

    await waitFor(() => expect(tagsApi.removeFromFile).toHaveBeenCalledWith('file-1', 't1'));
    await waitFor(() => expect(screen.queryByText('taxes')).toBeNull());
    expect(screen.getByText('archive')).toBeTruthy();
  });

  it('drops the chip optimistically, before the request resolves', async () => {
    let release: () => void = () => {};
    tagsApi.removeFromFile.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    renderPanel();
    fireEvent.click(await screen.findByLabelText('Remove tag taxes'));

    // The request is still in flight and the chip is already gone.
    await waitFor(() => expect(screen.queryByText('taxes')).toBeNull());
    release();
  });

  it('restores the chip and explains a failed removal', async () => {
    tagsApi.removeFromFile.mockRejectedValue({ statusCode: 403 });
    renderPanel();

    fireEvent.click(await screen.findByLabelText('Remove tag taxes'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'You need edit access to change tags on this file',
      ),
    );
    expect(await screen.findByText('taxes')).toBeTruthy();
  });

  it('opens with the picker expanded when asked to focus tags', async () => {
    renderPanel(true);

    expect(await screen.findByLabelText('Find or create a tag')).toBeTruthy();
  });

  it('keeps the picker closed by default', async () => {
    renderPanel();

    await screen.findByText('taxes');
    expect(screen.queryByLabelText('Find or create a tag')).toBeNull();
  });
});
