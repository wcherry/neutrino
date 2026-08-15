/**
 * The dialog shown straight after registration: it mints the encryption key
 * itself from the account password, then offers a passkey and shows the
 * recovery code once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const provisionVault = vi.fn();
const enrollPasskey = vi.fn();
vi.mock('@neutrino/auth', () => ({
  provisionVault: (...args: unknown[]) => provisionVault(...args),
  enrollPasskey: (...args: unknown[]) => enrollPasskey(...args),
}));

let passkeySupported = true;
vi.mock('@neutrino/e2e-crypto', () => ({
  isPasskeySupported: () => passkeySupported,
}));

import { EncryptionSetupDialog } from '@/components/EncryptionSetupDialog';

function renderDialog(onDone = vi.fn()) {
  render(
    <EncryptionSetupDialog
      userId="u1"
      userEmail="w@example.com"
      accountPassword="correct-horse"
      onDone={onDone}
    />,
  );
  return onDone;
}

async function ready() {
  await waitFor(() => expect(screen.getByText('CODE-1234-5678')).toBeInTheDocument());
}

describe('EncryptionSetupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passkeySupported = true;
    provisionVault.mockResolvedValue({ recoveryCode: 'CODE-1234-5678' });
    enrollPasskey.mockResolvedValue({ id: 'pk1' });
  });

  it('provisions the vault on open with the account password, asking nothing', async () => {
    renderDialog();

    await waitFor(() =>
      expect(provisionVault).toHaveBeenCalledWith('u1', 'w@example.com', 'correct-horse'),
    );
    await ready();
    // The code is the only way back in, so leaving is blocked until it is saved.
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('provisions once, not once per render', async () => {
    const { rerender } = render(
      <EncryptionSetupDialog
        userId="u1"
        userEmail="w@example.com"
        accountPassword="correct-horse"
        onDone={vi.fn()}
      />,
    );
    await ready();
    rerender(
      <EncryptionSetupDialog
        userId="u1"
        userEmail="w@example.com"
        accountPassword="correct-horse"
        onDone={vi.fn()}
      />,
    );

    // A second call would mint a second master key over the first, stranding
    // the recovery code already on screen.
    expect(provisionVault).toHaveBeenCalledTimes(1);
  });

  it('enrols a passkey against the freshly unlocked session', async () => {
    renderDialog();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }));
    await waitFor(() => expect(screen.getByText('Passkey added')).toBeInTheDocument());
    expect(enrollPasskey).toHaveBeenCalledWith('u1', 'w@example.com', expect.any(String));
  });

  it('keeps the recovery code reachable when the passkey prompt is refused', async () => {
    enrollPasskey.mockRejectedValue(new Error('The operation was aborted.'));
    const onDone = renderDialog();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }));
    await waitFor(() => expect(screen.getByText('The operation was aborted.')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/I have saved my recovery code/));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('hides the passkey option where the platform has no support', async () => {
    passkeySupported = false;
    renderDialog();
    await ready();

    expect(screen.queryByRole('button', { name: /Add passkey/ })).not.toBeInTheDocument();
  });

  it('offers a retry when provisioning fails, and lets the user move on', async () => {
    provisionVault.mockRejectedValueOnce(new Error('Network error'));
    const onDone = renderDialog();

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    expect(provisionVault).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('lets the user leave a failed setup for the unlock gate to pick up', async () => {
    provisionVault.mockRejectedValue(new Error('Network error'));
    const onDone = renderDialog();

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue without it' }));
    expect(onDone).toHaveBeenCalled();
  });
});
