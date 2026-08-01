/**
 * Unit tests for the Drive tag picker.
 *
 * Covers:
 *   - Lists the user's tags with usage counts and checked state
 *   - Filters the list client-side as the user types
 *   - Toggling an unapplied tag calls addToFile; an applied one calls removeFromFile
 *   - "Create «name»" appears only when no tag matches exactly, and creates + applies
 *   - A 403 write surfaces the "needs edit access" message rather than a generic one
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Tag } from '@neutrino/api-drive';

const toastError = vi.fn();
const toastSuccess = vi.fn();

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
  addToFile: vi.fn(),
  removeFromFile: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  get tagsApi() {
    return tagsApi;
  },
}));

import { TagPicker } from '../../app/(apps)/drive/TagPicker';

function tag(id: string, name: string, fileCount = 0): Tag {
  return { id, name, fileCount, createdAt: '2026-01-01T00:00:00' };
}

const TAXES = tag('t1', 'taxes', 3);
const TRAVEL = tag('t2', 'travel', 1);

function renderPicker(appliedTags: Tag[] = [], open = true, onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TagPicker
        fileId="file-1"
        open={open}
        onOpenChange={onOpenChange}
        appliedTags={appliedTags}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tagsApi.list.mockResolvedValue({ tags: [TAXES, TRAVEL], total: 2 });
  tagsApi.addToFile.mockResolvedValue(undefined);
  tagsApi.removeFromFile.mockResolvedValue(undefined);
  tagsApi.create.mockResolvedValue(tag('t3', 'new-tag'));
});

describe('TagPicker', () => {
  it('renders only its trigger while closed', () => {
    renderPicker([], false);

    expect(screen.getByRole('button', { name: /add tag/i })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Manage tags' })).toBeNull();
  });

  it('toggles open state from its own trigger', () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderPicker([], false, onOpenChange);

    fireEvent.click(screen.getByRole('button', { name: /add tag/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={client}>
        <TagPicker fileId="file-1" open onOpenChange={onOpenChange} appliedTags={[]} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /add tag/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    renderPicker([], true, onOpenChange);
    await screen.findByRole('checkbox', { name: /taxes/ });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lists every tag with its usage count and checked state', async () => {
    renderPicker([TAXES]);

    const taxes = await screen.findByRole('checkbox', { name: /taxes/ });
    expect(taxes.getAttribute('aria-checked')).toBe('true');
    expect(taxes.textContent).toContain('3');

    const travel = screen.getByRole('checkbox', { name: /travel/ });
    expect(travel.getAttribute('aria-checked')).toBe('false');
  });

  it('filters the list as the user types', async () => {
    renderPicker();
    await screen.findByRole('checkbox', { name: /taxes/ });

    fireEvent.change(screen.getByLabelText('Find or create a tag'), {
      target: { value: 'trav' },
    });

    expect(screen.queryByRole('checkbox', { name: /taxes/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /travel/ })).toBeTruthy();
  });

  it('adds a tag that is not yet applied', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('checkbox', { name: /travel/ }));

    await waitFor(() => expect(tagsApi.addToFile).toHaveBeenCalledWith('file-1', 't2'));
    expect(tagsApi.removeFromFile).not.toHaveBeenCalled();
  });

  it('removes a tag that is already applied', async () => {
    renderPicker([TAXES]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /taxes/ }));

    await waitFor(() => expect(tagsApi.removeFromFile).toHaveBeenCalledWith('file-1', 't1'));
    expect(tagsApi.addToFile).not.toHaveBeenCalled();
  });

  it('offers to create a tag only when nothing matches exactly', async () => {
    renderPicker();
    const input = await screen.findByLabelText('Find or create a tag');

    fireEvent.change(input, { target: { value: 'budget' } });
    expect(screen.getByText(/Create/)).toBeTruthy();

    // An exact (case-insensitive) match means the tag already exists.
    fireEvent.change(input, { target: { value: 'Taxes' } });
    expect(screen.queryByText(/Create/)).toBeNull();
  });

  it('creates the tag and applies it to the file in one step', async () => {
    renderPicker();
    const input = await screen.findByLabelText('Find or create a tag');
    fireEvent.change(input, { target: { value: 'budget' } });
    fireEvent.click(screen.getByText(/Create/));

    await waitFor(() => expect(tagsApi.create).toHaveBeenCalledWith('budget'));
    await waitFor(() => expect(tagsApi.addToFile).toHaveBeenCalledWith('file-1', 't3'));
  });

  it('explains a 403 as missing edit access', async () => {
    tagsApi.addToFile.mockRejectedValue({ statusCode: 403 });
    renderPicker();

    fireEvent.click(await screen.findByRole('checkbox', { name: /travel/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'You need edit access to change tags on this file',
      ),
    );
  });

  it('reports a duplicate name when creating an existing tag', async () => {
    tagsApi.create.mockRejectedValue({ statusCode: 409 });
    renderPicker();

    const input = await screen.findByLabelText('Find or create a tag');
    fireEvent.change(input, { target: { value: 'budget' } });
    fireEvent.click(screen.getByText(/Create/));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('A tag with that name already exists'),
    );
  });
});
