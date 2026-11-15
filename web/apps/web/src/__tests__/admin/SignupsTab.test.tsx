/**
 * The admin Sign-ups tab: the summary's rows fill the filter, Preview runs a
 * dry run, and Delete sends exactly the request that was previewed — and
 * disappears the moment the filter changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const summary = vi.fn();
const bulkDelete = vi.fn();
vi.mock('@neutrino/api-admin', () => ({
  signupsApi: {
    summary: (...a: unknown[]) => summary(...a),
    bulkDelete: (...a: unknown[]) => bulkDelete(...a),
  },
  toServerTimestamp: (d: Date) => d.toISOString().slice(0, 19),
}));
vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div>loading</div>,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { SignupsTab, toRequest } from '@/app/(apps)/admin/SignupsTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SignupsTab />
    </QueryClientProvider>,
  );
}

const sample = {
  id: 'u1',
  email: 'bot1@bots.example',
  name: 'Bot',
  createdAt: '2026-11-14T10:00:00',
  emailVerified: false,
  signupIp: '6.6.6.6',
};

describe('SignupsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summary.mockResolvedValue({
      hours: 24,
      total: 500,
      unverified: 498,
      byIp: [{ key: '6.6.6.6', total: 480, unverified: 480 }],
      byDomain: [{ key: 'bots.example', total: 470, unverified: 470 }],
    });
    bulkDelete.mockImplementation(async (req: { dryRun: boolean }) => ({
      dryRun: req.dryRun,
      matched: 480,
      deleted: req.dryRun ? 0 : 480,
      sample: [sample],
    }));
  });

  it('previews, then deletes exactly what was previewed', async () => {
    renderTab();
    expect(await screen.findByText('6.6.6.6')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Filter')[0]);
    expect(screen.getByLabelText('Sign-up IP')).toHaveValue('6.6.6.6');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(bulkDelete).toHaveBeenCalledWith({ ip: '6.6.6.6', dryRun: true }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 480 accounts' }));
    await waitFor(() =>
      expect(bulkDelete).toHaveBeenLastCalledWith({ ip: '6.6.6.6', dryRun: false }),
    );
  });

  it('drops the preview when the filter changes', async () => {
    renderTab();
    await screen.findByText('6.6.6.6');
    fireEvent.change(screen.getByLabelText('Email domain'), { target: { value: 'bots.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('button', { name: 'Delete 480 accounts' });
    fireEvent.change(screen.getByLabelText('Email domain'), { target: { value: 'other.example' } });
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('needs an IP, domain or start time before it will preview', async () => {
    renderTab();
    await screen.findByText('6.6.6.6');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('builds requests without empty fields and strips a leading @', () => {
    expect(
      toRequest({ ip: ' ', emailDomain: '@Bots.example', createdAfter: '', createdBefore: '', includeVerified: false }),
    ).toEqual({ ip: undefined, emailDomain: 'Bots.example', createdAfter: undefined, createdBefore: undefined, includeVerified: undefined });
  });
});
