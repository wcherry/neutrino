/**
 * A dismissed unlock gate has to be reachable again — Settings offers "Unlock
 * key" / "Set up encryption" buttons that do nothing else but ask for it back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

const getVaultState = vi.fn();
vi.mock('@neutrino/auth', () => ({
  getVaultState: (...args: unknown[]) => getVaultState(...args),
  provisionVault: vi.fn(),
  unlockWithPassword: vi.fn(),
  unlockWithPasskey: vi.fn(),
  unlockWithRecoveryCode: vi.fn(),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  isPasskeySupported: () => false,
}));

import { E2EEUnlockGate, requestEncryptionGate } from '@/components/E2EEUnlockGate';

const LOCKED_VAULT = {
  encryptedIdentity: 'x',
  publicKey: 'y',
  version: 1,
  unlocks: [{ method: 'password' as const, label: 'Password', encryptedMasterKey: 'z', params: '{}' }],
};

describe('E2EEUnlockGate re-entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comes back after being dismissed when something asks for it', async () => {
    getVaultState.mockResolvedValue({ state: 'locked', vault: LOCKED_VAULT });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument();

    await act(async () => {
      requestEncryptionGate();
    });
    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());
  });

  it('re-reads the vault on request, so a key made elsewhere is not re-offered', async () => {
    getVaultState.mockResolvedValue({ state: 'locked', vault: LOCKED_VAULT });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);
    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());

    getVaultState.mockResolvedValue({ state: 'unlocked', vault: null });
    await act(async () => {
      requestEncryptionGate();
    });

    await waitFor(() => expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument());
  });

  it('offers provisioning, not unlocking, for an account with no vault', async () => {
    getVaultState.mockResolvedValue({ state: 'none', vault: null });
    render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);

    await waitFor(() =>
      expect(screen.getByText('Protect your encryption key')).toBeInTheDocument(),
    );
  });
});
