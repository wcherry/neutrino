/**
 * Access requests: the page the "is asking for access" email leads to lists what is asked and by
 * whom, and approving hands an encrypted file's key over after the grant — the server refuses to
 * take a key for someone with no access yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const calls: string[] = [];
const listPending = vi.fn();
const approve = vi.fn(async () => {
  calls.push('approve');
});
const deny = vi.fn();
const getFileKey = vi.fn();
const shareFileKey = vi.fn(async () => {
  calls.push('share-key');
});
const getUserPublicKey = vi.fn();
const openFileKey = vi.fn(async () => new Uint8Array(32));

vi.mock('@/lib/api', () => ({
  accessRequestsApi: {
    listPending: () => listPending(),
    approve: (...a: unknown[]) => approve(...(a as [])),
    deny: (...a: unknown[]) => deny(...a),
  },
  encryptionApi: {
    getFileKey: (...a: unknown[]) => getFileKey(...a),
    shareFileKey: (...a: unknown[]) => shareFileKey(...(a as [])),
  },
  authApi: { getUserPublicKey: (...a: unknown[]) => getUserPublicKey(...a) },
  openFileKey: (...a: unknown[]) => openFileKey(...(a as [])),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(async () => {}),
  loadKeyPair: vi.fn(() => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })),
  encryptFileKey: vi.fn(() => 'sealed'),
  fromBase64url: vi.fn(() => new Uint8Array(32)),
  checkKey: vi.fn(() => ({ status: 'pinned' })),
  pinKey: vi.fn(),
}));

vi.mock('@neutrino/auth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));

import AccessRequestsPage from '@/app/(apps)/drive/requests/page';

const request = {
  id: 'r1',
  resourceType: 'file',
  resourceId: 'f1',
  requesterId: 'bob',
  requesterEmail: 'bob@example.com',
  requesterName: 'Bob',
  message: 'For the Q4 review',
  requestedRole: 'editor',
  status: 'pending',
  createdAt: '2026-11-03 10:00:00',
  updatedAt: '2026-11-03 10:00:00',
  resourceName: 'Budget',
  mimeType: 'application/vnd.neutrino.sheet',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccessRequestsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});

describe('AccessRequestsPage', () => {
  it('lists each request with who asked, for what, and why', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    renderPage();
    expect(await screen.findByText(/asked to edit the file “Budget”/)).toHaveTextContent('Bob (bob@example.com)');
    expect(screen.getByText('“For the Q4 review”')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('approves, then seals the encrypted file’s key to the requester', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    getFileKey.mockResolvedValue({ encryptedKey: 'x' });
    getUserPublicKey.mockResolvedValue({ publicKey: 'pk', version: 2 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Bob can now open it.');
    expect(approve).toHaveBeenCalledWith('r1', { requesterEmail: 'bob@example.com', requesterName: 'Bob' });
    expect(shareFileKey).toHaveBeenCalledWith('f1', { recipientId: 'bob', encryptedFileKey: 'sealed', keyVersion: 2 });
    expect(calls).toEqual(['approve', 'share-key']);
  });

  it('approves a plaintext file without touching keys', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    getFileKey.mockResolvedValue(null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Bob can now open it.');
    expect(shareFileKey).not.toHaveBeenCalled();
  });

  it('says so when the requester has no encryption key to seal to', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    getFileKey.mockResolvedValue({ encryptedKey: 'x' });
    getUserPublicKey.mockResolvedValue(null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status')).toHaveTextContent('hasn’t set up encryption yet');
  });

  it('declines', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    deny.mockResolvedValue({ ...request, status: 'denied' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Declined. Bob has been told.');
    expect(deny).toHaveBeenCalledWith('r1');
    expect(approve).not.toHaveBeenCalled();
  });

  it('shows a refusal against the row, such as an unverified address', async () => {
    listPending.mockResolvedValue({ requests: [request] });
    approve.mockRejectedValueOnce(new Error('Verify your email address to share files.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verify your email address to share files.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('says when there is nothing to answer', async () => {
    listPending.mockResolvedValue({ requests: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('No requests')).toBeInTheDocument());
  });
});
