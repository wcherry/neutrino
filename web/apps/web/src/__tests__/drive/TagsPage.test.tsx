/**
 * Unit tests for the /drive/tags management page.
 *
 * Covers:
 *   - Tags are listed most-used first, with file counts
 *   - Creating a tag; a duplicate name surfaces the 409 message
 *   - Renaming a tag inline
 *   - Deleting asks for confirmation and makes clear the files survive
 *   - Empty state when the user has no tags
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Tag } from '@neutrino/api-drive';

const toastError = vi.fn();
const toastSuccess = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/drive/tags',
  useParams: () => ({ id: 't1' }),
}));

vi.mock('@neutrino/ui', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/ui')>('@neutrino/ui');
  return {
    ...actual,
    useToast: () => ({
      error: toastError,
      success: toastSuccess,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

const tagsApi = {
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  get tagsApi() {
    return tagsApi;
  },
}));

import TagsPage from '../../app/(apps)/drive/tags/page';

function tag(id: string, name: string, fileCount: number): Tag {
  return { id, name, fileCount, createdAt: '2026-01-01T00:00:00' };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TagsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tagsApi.list.mockResolvedValue({
    tags: [tag('t1', 'travel', 2), tag('t2', 'taxes', 7), tag('t3', 'archive', 0)],
    total: 3,
  });
  tagsApi.create.mockResolvedValue(tag('t4', 'budget', 0));
  tagsApi.rename.mockResolvedValue(tag('t1', 'trips', 2));
  tagsApi.remove.mockResolvedValue(undefined);
});

describe('TagsPage', () => {
  it('orders tags by usage, most used first', async () => {
    renderPage();
    await screen.findByText('taxes');

    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toContain('taxes'); // 7 files
    expect(names[1]).toContain('travel'); // 2 files
    expect(names[2]).toContain('archive'); // 0 files
  });

  it('shows a file count per tag, singular for one', async () => {
    tagsApi.list.mockResolvedValue({ tags: [tag('t1', 'solo', 1)], total: 1 });
    renderPage();

    expect(await screen.findByText('1 file')).toBeTruthy();
  });

  it('creates a tag', async () => {
    renderPage();
    await screen.findByText('taxes');

    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'budget' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(tagsApi.create).toHaveBeenCalledWith('budget'));
  });

  it('surfaces the duplicate-name error on create', async () => {
    tagsApi.create.mockRejectedValue({ statusCode: 409 });
    renderPage();
    await screen.findByText('taxes');

    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'taxes' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('A tag with that name already exists'),
    );
  });

  it('renames a tag inline', async () => {
    renderPage();
    await screen.findByText('travel');

    fireEvent.click(screen.getByRole('button', { name: 'Rename travel' }));
    fireEvent.change(screen.getByLabelText('Rename travel'), { target: { value: 'trips' } });
    fireEvent.submit(screen.getByLabelText('Rename travel'));

    await waitFor(() =>
      expect(tagsApi.rename).toHaveBeenCalledWith('t1', 'trips'),
    );
  });

  it('confirms before deleting and promises the files survive', async () => {
    renderPage();
    await screen.findByText('travel');

    fireEvent.click(screen.getByRole('button', { name: 'Delete travel' }));

    expect(screen.getByText(/files themselves are not/i)).toBeTruthy();
    expect(tagsApi.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete tag' }));
    await waitFor(() => expect(tagsApi.remove).toHaveBeenCalledWith('t1'));
  });

  it('shows an empty state when there are no tags', async () => {
    tagsApi.list.mockResolvedValue({ tags: [], total: 0 });
    renderPage();

    expect(await screen.findByText('No tags yet')).toBeTruthy();
  });
});
