/**
 * The admin's Product Updates tab: write a draft, publish it into the next weekly email, take it
 * back, and preview the caller's own weekly email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  setPublished: vi.fn(),
  remove: vi.fn(),
  previewWeeklyEmail: vi.fn(),
}));
vi.mock('@neutrino/api-admin', () => ({ productUpdatesApi: api }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('@neutrino/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@neutrino/ui')>()),
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { ProductUpdatesTab } from '@/app/(apps)/admin/ProductUpdatesTab';

const draft = {
  id: 'u1',
  title: 'Faster search',
  body: 'Search is quicker.',
  createdAt: '2026-11-02 10:00:00',
  updatedAt: '2026-11-02 10:00:00',
  publishedAt: null,
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductUpdatesTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProductUpdatesTab', () => {
  it('saves a new update as a draft', async () => {
    api.list.mockResolvedValue([]);
    api.create.mockResolvedValue(draft);
    renderTab();
    expect(await screen.findByText('No updates yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Faster search' } });
    fireEvent.change(screen.getByLabelText(/^Update/), { target: { value: 'Search is quicker.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toEqual({ title: 'Faster search', body: 'Search is quicker.' });
  });

  it('publishes a draft and unpublishes a published update', async () => {
    api.list.mockResolvedValue([draft, { ...draft, id: 'u2', title: 'Dark mode', publishedAt: '2026-11-01 09:00:00' }]);
    api.setPublished.mockResolvedValue(draft);
    renderTab();

    const draftRow = (await screen.findByText('Faster search')).closest('tr') as HTMLElement;
    expect(within(draftRow).getByText('Draft')).toBeInTheDocument();
    fireEvent.click(within(draftRow).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.setPublished).toHaveBeenCalledWith('u1', true));

    const publishedRow = screen.getByText('Dark mode').closest('tr') as HTMLElement;
    expect(within(publishedRow).getByText(/^Published /)).toBeInTheDocument();
    fireEvent.click(within(publishedRow).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(api.setPublished).toHaveBeenCalledWith('u2', false));
  });

  it('edits an update in place', async () => {
    api.list.mockResolvedValue([draft]);
    api.edit.mockResolvedValue(draft);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const titles = screen.getAllByLabelText(/^Title/);
    fireEvent.change(titles[titles.length - 1], { target: { value: 'Much faster search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.edit).toHaveBeenCalledWith('u1', { title: 'Much faster search', body: 'Search is quicker.' }),
    );
  });

  it('reports a refused save', async () => {
    api.list.mockResolvedValue([]);
    api.create.mockRejectedValue(new Error('The title must be at most 200 characters'));
    renderTab();
    await screen.findByText('No updates yet.');
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^Update/), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('The title must be at most 200 characters'));
  });

  it('previews the weekly email, or says there would be none', async () => {
    api.list.mockResolvedValue([]);
    api.previewWeeklyEmail.mockResolvedValueOnce(null);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview my weekly email' }));
    expect(await screen.findByText(/wouldn’t get an email this week/)).toHaveAttribute('role', 'status');

    api.previewWeeklyEmail.mockResolvedValueOnce({ subject: 'Your week in Neutrino', text: 't', html: '<p>Hi</p>' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview my weekly email' }));
    const preview = await screen.findByRole('region', { name: 'Weekly email preview' });
    expect(preview).toHaveTextContent('Your week in Neutrino');
    expect(within(preview).getByTitle('Weekly email preview')).toHaveAttribute('sandbox', '');
  });
});
