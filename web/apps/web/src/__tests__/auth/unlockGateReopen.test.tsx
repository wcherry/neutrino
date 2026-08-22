/**
 * A dismissed unlock gate has to be reachable again — Settings offers "Unlock
 * key" / "Set up encryption" buttons that do nothing else but ask for it back.
 *
 * Also pins the distinction the gate exists to draw: an account with a
 * published key that this browser has no copy of must be offered *restore*, not
 * *create*. Creating there would mint a second identity and orphan every file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

const getKeyringState = vi.fn();
vi.mock('@neutrino/auth', () => ({
  getKeyringState: (...args: unknown[]) => getKeyringState(...args),
  provisionKeyring: vi.fn(),
  unlockKeyring: vi.fn(),
  restoreFromRecoveryKit: vi.fn(),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  isPasskeySupported: () => false,
}));

import { E2EEUnlockGate, requestEncryptionGate } from '@/components/E2EEUnlockGate';

const LOCAL_PASSPHRASE = { method: 'passphrase' as const, updatedAt: '2026-08-20T00:00:00Z' };

describe('E2EEUnlockGate re-entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comes back after being dismissed when something asks for it', async () => {
    getKeyringState.mockResolvedValue({ state: 'locked', local: LOCAL_PASSPHRASE });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument();

    await act(async () => {
      requestEncryptionGate();
    });
    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());
  });

  it('re-reads the state on request, so a key unlocked elsewhere is not re-offered', async () => {
    getKeyringState.mockResolvedValue({ state: 'locked', local: LOCAL_PASSPHRASE });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);
    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());

    getKeyringState.mockResolvedValue({ state: 'unlocked', local: null });
    await act(async () => {
      requestEncryptionGate();
    });

    await waitFor(() => expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument());
  });

  it('offers key creation for an account that has none', async () => {
    getKeyringState.mockResolvedValue({ state: 'none', local: null });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() => expect(screen.getByText('Set up encryption')).toBeInTheDocument());
  });

  it('offers restore, never creation, when the account has a key this device lacks', async () => {
    // Creating here would mint a second identity and orphan every existing file,
    // which is unrecoverable — so the create path must be absent, not merely
    // discouraged.
    getKeyringState.mockResolvedValue({ state: 'needs-device', local: null });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() =>
      expect(screen.getByText('This device needs your key')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Create my key' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore my key' })).toBeInTheDocument();
  });

  it('leaves the app usable when the state lookup fails', async () => {
    // Offline or a server outage must not trap the user behind a modal.
    getKeyringState.mockRejectedValue(new Error('offline'));
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() => expect(getKeyringState).toHaveBeenCalled());
    expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument();
    expect(screen.queryByText('Set up encryption')).not.toBeInTheDocument();
  });
});
