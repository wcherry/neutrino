/**
 * The unlock dialog must not appear.
 *
 * A key created now is wrapped so this device opens it unattended, so
 * `getKeyringState` reports 'unlocked' before anything renders and the gate has
 * nothing to ask. These pin that, and pin the one case that still prompts — a
 * browser enrolled before the change, whose stored record is wrapped under a
 * passphrase and cannot be opened without it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const getKeyringState = vi.fn();
const unlockKeyring = vi.fn();
const provisionKeyring = vi.fn();

vi.mock('@neutrino/auth', () => ({
  getKeyringState: (...args: unknown[]) => getKeyringState(...args),
  unlockKeyring: (...args: unknown[]) => unlockKeyring(...args),
  provisionKeyring: (...args: unknown[]) => provisionKeyring(...args),
  restoreFromRecoveryKit: vi.fn(),
}));

import { E2EEUnlockGate } from '@/components/E2EEUnlockGate';

function renderGate() {
  render(<E2EEUnlockGate userId="u1" userName="w@example.com" />);
}

describe('the removed passphrase prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionKeyring.mockResolvedValue({ recoveryKit: 'KIT0-1234-5678' });
  });

  it('renders nothing when the device opened its own key', async () => {
    // What getKeyringState now reports for a device-wrapped record: it unlocks
    // it itself rather than handing back 'locked'.
    getKeyringState.mockResolvedValue({ state: 'unlocked', local: null });
    renderGate();

    await waitFor(() => expect(getKeyringState).toHaveBeenCalled());
    expect(screen.queryByText('Unlock your files')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
  });

  it('creates a key without asking for a passphrase', async () => {
    getKeyringState.mockResolvedValue({ state: 'none', local: null });
    renderGate();

    await waitFor(() => expect(screen.getByText('Set up encryption')).toBeInTheDocument());
    // The two passphrase fields that used to gate this button are gone.
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create my key' }));
    await waitFor(() =>
      expect(provisionKeyring).toHaveBeenCalledWith('u1', 'w@example.com', { method: 'device' }),
    );
  });

  it('restores from a recovery kit without setting a passphrase', async () => {
    getKeyringState.mockResolvedValue({ state: 'needs-device', local: null });
    renderGate();

    await waitFor(() =>
      expect(screen.getByText('This device needs your key')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Recovery kit')).toBeInTheDocument();
    expect(screen.queryByLabelText('New passphrase for this device')).not.toBeInTheDocument();
  });

  it('still asks a device enrolled before the change, so it is not locked out', async () => {
    getKeyringState.mockResolvedValue({
      state: 'locked',
      local: { method: 'passphrase', updatedAt: '2026-08-20T00:00:00Z' },
    });
    renderGate();

    await waitFor(() => expect(screen.getByText('Unlock your files')).toBeInTheDocument());
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });
});
