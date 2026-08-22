/**
 * Sharing must not seal a file's DEK to a recipient key that changed underneath
 * us. The key comes from the server unsigned, so a swap is indistinguishable
 * from a genuine rotation — the user decides, and nothing is sealed until they
 * do. See `packages/e2e-crypto/src/pinning.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const grantPermission = vi.fn();
const getUserPublicKey = vi.fn();
const getFileKey = vi.fn();
const shareFileKey = vi.fn();
const lookupByEmail = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/api', () => ({
  permissionsApi: {
    listPermissions: vi.fn().mockResolvedValue({ permissions: [] }),
    grantPermission: (...a: unknown[]) => grantPermission(...a),
    updatePermission: vi.fn(),
    revokePermission: vi.fn(),
  },
  sharingApi: {
    getShareLink: vi.fn().mockResolvedValue(null),
    upsertShareLink: vi.fn(),
    updateShareLink: vi.fn(),
    deleteShareLink: vi.fn(),
  },
  usersApi: {
    lookupByEmail: (...a: unknown[]) => lookupByEmail(...a),
    searchUsers: vi.fn().mockResolvedValue([]),
  },
  authApi: { getUserPublicKey: (...a: unknown[]) => getUserPublicKey(...a) },
  encryptionApi: {
    getFileKey: (...a: unknown[]) => getFileKey(...a),
    shareFileKey: (...a: unknown[]) => shareFileKey(...a),
  },
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'owner-1' }) }));

// The real pinning module is exercised — it is the thing under test. Only the
// sodium-backed crypto around it is stubbed.
vi.mock('@neutrino/e2e-crypto', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/e2e-crypto')>(
    '@neutrino/e2e-crypto',
  );
  return {
    ...actual,
    initSodium: vi.fn().mockResolvedValue(undefined),
    loadKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
    openSealedFileKey: () => new Uint8Array(32),
    encryptFileKey: () => 'sealed-dek',
    fromBase64url: () => new Uint8Array(32),
    fingerprintFor: (_u: string, key: string) => `FP-${key}`,
  };
});

vi.mock('@neutrino/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@neutrino/ui');
  return {
    ...actual,
    useToast: () => ({ error: toastError, success: vi.fn() }),
    // The presentational share dialog is replaced by a single button that fires
    // the callback under test; its own behaviour is covered elsewhere.
    ShareDialog: ({ onAddPerson }: { onAddPerson: (e: string, r: string) => Promise<void> }) => (
      <button onClick={() => void onAddPerson('bob@example.com', 'viewer').catch(() => {})}>
        add-person
      </button>
    ),
  };
});

import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { pinKey, checkKey } from '@neutrino/e2e-crypto';

const FILE = { id: 'file-1', name: 'Secret.pdf' } as never;

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShareDialog resource={FILE} resourceType="file" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function addPerson() {
  fireEvent.click(await screen.findByText('add-person'));
}

describe('sharing a file key against a pinned recipient key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    lookupByEmail.mockResolvedValue({ id: 'bob', email: 'bob@example.com', name: 'Bob' });
    grantPermission.mockResolvedValue({});
    getFileKey.mockResolvedValue({ encryptedFileKey: 'dek-for-owner' });
    shareFileKey.mockResolvedValue({});
  });

  it('pins on first use and shares without interrupting anyone', async () => {
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'bob-key-1', version: 1 });

    renderDialog();
    await addPerson();

    await waitFor(() => expect(shareFileKey).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/encryption key has changed/i)).not.toBeInTheDocument();
    expect(checkKey('owner-1', 'bob', 'bob-key-1').status).toBe('trusted');
  });

  it('shares silently when the offered key matches the pin', async () => {
    pinKey('owner-1', 'bob', 'bob-key-1');
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'bob-key-1', version: 1 });

    renderDialog();
    await addPerson();

    await waitFor(() => expect(shareFileKey).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/encryption key has changed/i)).not.toBeInTheDocument();
  });

  it('does not seal the DEK while the key-change dialog is open', async () => {
    pinKey('owner-1', 'bob', 'bob-key-1');
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'attacker-key', version: 1 });

    renderDialog();
    await addPerson();

    await waitFor(() =>
      expect(screen.getByText(/encryption key has changed/i)).toBeInTheDocument(),
    );
    expect(shareFileKey).not.toHaveBeenCalled();
  });

  it('shows both fingerprints so the change can be compared', async () => {
    pinKey('owner-1', 'bob', 'bob-key-1');
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'attacker-key', version: 1 });

    renderDialog();
    await addPerson();

    await waitFor(() => expect(screen.getByText('FP-bob-key-1')).toBeInTheDocument());
    expect(screen.getByText('FP-attacker-key')).toBeInTheDocument();
  });

  it('never shares the key when the user declines the change', async () => {
    pinKey('owner-1', 'bob', 'bob-key-1');
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'attacker-key', version: 1 });

    renderDialog();
    await addPerson();

    fireEvent.click(await screen.findByRole('button', { name: /don.t share/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(shareFileKey).not.toHaveBeenCalled();
    // The pin is untouched, so the next attempt is challenged again rather than
    // quietly accepting the key that was just refused.
    expect(checkKey('owner-1', 'bob', 'attacker-key').status).toBe('changed');
  });

  it('shares and re-pins as verified once the user vouches for the new key', async () => {
    pinKey('owner-1', 'bob', 'bob-key-1');
    getUserPublicKey.mockResolvedValue({ userId: 'bob', publicKey: 'bob-key-2', version: 2 });

    renderDialog();
    await addPerson();

    fireEvent.click(await screen.findByRole('button', { name: /trust the new key/i }));

    await waitFor(() => expect(shareFileKey).toHaveBeenCalledTimes(1));
    const result = checkKey('owner-1', 'bob', 'bob-key-2');
    expect(result.status).toBe('trusted');
    if (result.status !== 'trusted') throw new Error('unreachable');
    expect(result.pinned.verifiedAt).not.toBeNull();
  });

  it('leaves plaintext files alone — nothing to pin when there is no DEK', async () => {
    getFileKey.mockResolvedValue(null);

    renderDialog();
    await addPerson();

    await waitFor(() => expect(grantPermission).toHaveBeenCalled());
    expect(getUserPublicKey).not.toHaveBeenCalled();
    expect(shareFileKey).not.toHaveBeenCalled();
  });
});
