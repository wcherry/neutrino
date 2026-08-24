/**
 * The dialog shown straight after registration: it mints the keyring itself,
 * wraps it to this device with the account password, then offers a passkey and
 * shows the recovery kit once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const provisionKeyring = vi.fn();
const storeUnderPasskey = vi.fn();
vi.mock('@neutrino/auth', () => ({
  provisionKeyring: (...args: unknown[]) => provisionKeyring(...args),
  currentRecoveryKit: vi.fn(),
}));

let passkeySupported = true;
vi.mock('@neutrino/e2e-crypto', () => ({
  isPasskeySupported: () => passkeySupported,
  storeUnderPasskey: (...args: unknown[]) => storeUnderPasskey(...args),
  getSessionKeyring: () => ({ userId: 'u1', entries: [] }),
}));

import { EncryptionSetupDialog } from '@/components/EncryptionSetupDialog';

function renderDialog(onDone = vi.fn()) {
  render(<EncryptionSetupDialog userId="u1" userEmail="w@example.com" onDone={onDone} />);
  return onDone;
}

async function ready() {
  await waitFor(() => expect(screen.getByText('KIT0-1234-5678')).toBeInTheDocument());
}

describe('EncryptionSetupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passkeySupported = true;
    provisionKeyring.mockResolvedValue({ recoveryKit: 'KIT0-1234-5678' });
    storeUnderPasskey.mockResolvedValue(undefined);
  });

  it('provisions on open under device wrapping, asking nothing', async () => {
    renderDialog();

    // Not the account password: wrapping under it is what sent a new sign-up to
    // the unlock dialog on their next load.
    await waitFor(() =>
      expect(provisionKeyring).toHaveBeenCalledWith('u1', 'w@example.com', {
        method: 'device',
      }),
    );
    await ready();
    // With no server-side copy, the kit is the only way back in — so leaving is
    // blocked until it is saved.
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('provisions once, not once per render', async () => {
    const { rerender } = render(
      <EncryptionSetupDialog userId="u1" userEmail="w@example.com" onDone={vi.fn()} />,
    );
    await ready();
    rerender(<EncryptionSetupDialog userId="u1" userEmail="w@example.com" onDone={vi.fn()} />);

    // A second call would mint a second identity over the first, stranding the
    // recovery kit already on screen.
    expect(provisionKeyring).toHaveBeenCalledTimes(1);
  });

  it('re-wraps this device’s keyring under a passkey when one is added', async () => {
    renderDialog();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }));
    await waitFor(() => expect(screen.getByText('Passkey added')).toBeInTheDocument());
    expect(storeUnderPasskey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'w@example.com',
      expect.any(String),
    );
  });

  it('keeps the recovery kit reachable when the passkey prompt is refused', async () => {
    storeUnderPasskey.mockRejectedValue(new Error('The operation was aborted.'));
    const onDone = renderDialog();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }));
    await waitFor(() => expect(screen.getByText('The operation was aborted.')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/I have saved my recovery kit/));
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
    provisionKeyring.mockRejectedValueOnce(new Error('Network error'));
    const onDone = renderDialog();

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    expect(provisionKeyring).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('lets the user leave a failed setup for the unlock gate to pick up', async () => {
    provisionKeyring.mockRejectedValue(new Error('Network error'));
    const onDone = renderDialog();

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue without it' }));
    expect(onDone).toHaveBeenCalled();
  });
});
