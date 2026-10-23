/**
 * Answering a request for a team file's key. The server refuses an approval until the requester
 * holds a key, so what matters here is the order — seal, then approve — and the cases where the
 * key is deliberately not sealed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserPublicKey = vi.fn();
const getFileKey = vi.fn();
const shareFileKey = vi.fn();
const approve = vi.fn();
const calls: string[] = [];

vi.mock('@/lib/api', () => ({
  teamsApi: { approveKeyRequest: (...a: unknown[]) => { calls.push('approve'); return approve(...a); } },
  authApi: { getUserPublicKey: (...a: unknown[]) => getUserPublicKey(...a) },
  openFileKey: async () => new Uint8Array(32),
  encryptionApi: {
    getFileKey: (...a: unknown[]) => getFileKey(...a),
    shareFileKey: (...a: unknown[]) => { calls.push('share'); return shareFileKey(...a); },
  },
}));

let keyPair: object | null = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
vi.mock('@neutrino/e2e-crypto', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/e2e-crypto')>('@neutrino/e2e-crypto');
  return {
    ...actual,
    initSodium: vi.fn().mockResolvedValue(undefined),
    loadKeyPair: () => keyPair,
    encryptFileKey: () => 'sealed-dek',
    fromBase64url: () => new Uint8Array(32),
  };
});

import { pinKey } from '@neutrino/e2e-crypto';
import { approveKeyRequest, describeKeyApproval } from '@/lib/teamKeyRequests';

const REQUEST = {
  id: 'kr1', teamId: 't1', fileId: 'f1', fileName: 'Plan.docx', requesterId: 'u3',
  requesterName: 'Bo', requesterEmail: 'bo@example.com', message: null, status: 'pending' as const,
  reason: null, decidedBy: null, decidedAt: null, createdAt: '', canDecide: true,
};

describe('approveKeyRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    localStorage.clear();
    keyPair = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
    getFileKey.mockResolvedValue({ encryptedFileKey: 'sealed', keyVersion: 1 });
    getUserPublicKey.mockResolvedValue({ publicKey: 'pk-u3', version: 4 });
  });

  it('seals the key to the requester with their key version, then approves', async () => {
    expect(await approveKeyRequest(REQUEST, 'u1')).toBe('approved');
    expect(shareFileKey).toHaveBeenCalledWith('f1', { recipientId: 'u3', encryptedFileKey: 'sealed-dek', keyVersion: 4 });
    expect(approve).toHaveBeenCalledWith('t1', 'kr1');
    expect(calls).toEqual(['share', 'approve']);
  });

  it('does not seal to a requester whose key changed since it was pinned', async () => {
    pinKey('u1', 'u3', 'pk-old');
    expect(await approveKeyRequest(REQUEST, 'u1')).toBe('unverified');
    expect(calls).toEqual([]);
  });

  it('reports a requester with no encryption set up, and an approver without the key', async () => {
    getUserPublicKey.mockResolvedValue(null);
    expect(await approveKeyRequest(REQUEST, 'u1')).toBe('requester-has-no-key');
    getFileKey.mockResolvedValue(null);
    expect(await approveKeyRequest(REQUEST, 'u1')).toBe('no-key-here');
    keyPair = null;
    expect(await approveKeyRequest(REQUEST, 'u1')).toBe('no-key-here');
    expect(calls).toEqual([]);
  });

  it('says what happened in a sentence', () => {
    expect(describeKeyApproval('approved', 'Bo')).toBe('Bo can now open the file.');
    expect(describeKeyApproval('unverified', 'Bo')).toMatch(/fingerprints/);
  });
});
