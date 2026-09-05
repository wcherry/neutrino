/**
 * Handing a team the key to a file it has just been given or lent (issue #185).
 *
 * The transfer itself is the server's business and is tested there. What is only testable here is
 * the half the server cannot do: a file's DEK is sealed per person, so a team that has been granted
 * access to an encrypted file still cannot open it until each member has been sealed a copy. These
 * pin down who gets one, who is skipped, and — the case worth the most care — who is deliberately
 * *not* sealed to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMembers = vi.fn();
const getUserPublicKey = vi.fn();
const getFileKey = vi.fn();
const shareFileKey = vi.fn();

vi.mock('@/lib/api', () => ({
  teamsApi: { listMembers: (...a: unknown[]) => listMembers(...a) },
  authApi: { getUserPublicKey: (...a: unknown[]) => getUserPublicKey(...a) },
  encryptionApi: {
    getFileKey: (...a: unknown[]) => getFileKey(...a),
    shareFileKey: (...a: unknown[]) => shareFileKey(...a),
  },
}));

// The real pinning module is exercised — a changed key is the thing under test. Only the
// sodium-backed crypto around it is stubbed.
vi.mock('@neutrino/e2e-crypto', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/e2e-crypto')>(
    '@neutrino/e2e-crypto'
  );
  return {
    ...actual,
    initSodium: vi.fn().mockResolvedValue(undefined),
    loadKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
    openSealedFileKey: () => new Uint8Array(32),
    encryptFileKey: () => 'sealed-dek',
    fromBase64url: () => new Uint8Array(32),
  };
});

import { pinKey } from '@neutrino/e2e-crypto';
import { describeKeyHandover, handFileKeyToTeam } from '@/lib/teamTransfer';

function member(userId: string, name: string) {
  return { userId, name, email: `${name}@example.com`, role: 'viewer', addedBy: 'owner-1' };
}

describe('handFileKeyToTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getFileKey.mockResolvedValue({ encryptedFileKey: 'sealed', keyVersion: 1 });
    getUserPublicKey.mockImplementation(async (userId: string) => ({
      publicKey: `pk-${userId}`,
      version: 2,
    }));
  });

  it('seals the key to every member except the caller', async () => {
    listMembers.mockResolvedValue({
      members: [member('owner-1', 'Owner'), member('u2', 'Ada'), member('u3', 'Bo')],
    });

    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');

    expect(result.shared.sort()).toEqual(['Ada', 'Bo']);
    expect(shareFileKey).toHaveBeenCalledTimes(2);
    // Sealed with the *recipient's* current key version, not the one the file was sealed to.
    expect(shareFileKey).toHaveBeenCalledWith('file-1', {
      recipientId: 'u2',
      encryptedFileKey: 'sealed-dek',
      keyVersion: 2,
    });
  });

  /**
   * The case this file exists for. A member whose public key is not what this browser pinned is
   * skipped and named, rather than sealed to — the key came from the server unsigned, so a swap is
   * indistinguishable from a rotation, and a bulk action is the wrong place to ask.
   */
  it('skips a member whose public key has changed since it was pinned', async () => {
    pinKey('owner-1', 'u2', 'pk-old');
    listMembers.mockResolvedValue({ members: [member('u2', 'Ada'), member('u3', 'Bo')] });

    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');

    expect(result.unverified).toEqual(['Ada']);
    expect(result.shared).toEqual(['Bo']);
    expect(shareFileKey).toHaveBeenCalledTimes(1);
    expect(describeKeyHandover(result)).toMatch(/Ada.*not been verified/);
  });

  it('reports a member with no public key rather than failing the handover', async () => {
    getUserPublicKey.mockImplementation(async (userId: string) =>
      userId === 'u2' ? null : { publicKey: `pk-${userId}`, version: 2 }
    );
    listMembers.mockResolvedValue({ members: [member('u2', 'Ada'), member('u3', 'Bo')] });

    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');

    expect(result.skipped).toEqual(['Ada']);
    expect(result.shared).toEqual(['Bo']);
    expect(describeKeyHandover(result)).toMatch(/Ada.*not set up encryption/);
  });

  /**
   * A file with no DEK is plaintext, and there is nothing to hand over. Reported as such rather
   * than as a failure, and silently: a toast about a key exchange the user never asked about is
   * noise on the common path.
   */
  it('is a no-op, and says nothing, for a plaintext file', async () => {
    getFileKey.mockResolvedValue(null);
    listMembers.mockResolvedValue({ members: [member('u2', 'Ada')] });

    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');

    expect(result.plaintext).toBe(true);
    expect(shareFileKey).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
    expect(describeKeyHandover(result)).toBeNull();
  });

  /**
   * The transfer has already landed by the time this runs, so a failure here reports an incomplete
   * handover — it never claims the transfer failed, and it never throws into the mutation that
   * would then report a successful move as an error.
   */
  it('does not throw when the member list cannot be read', async () => {
    listMembers.mockRejectedValue(new Error('offline'));

    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');

    expect(result.shared).toEqual([]);
    expect(result.plaintext).toBe(false);
  });

  it('says nothing when every member was sealed to', async () => {
    listMembers.mockResolvedValue({ members: [member('u2', 'Ada')] });
    const result = await handFileKeyToTeam('t1', 'file-1', 'owner-1');
    expect(describeKeyHandover(result)).toBeNull();
  });
});
