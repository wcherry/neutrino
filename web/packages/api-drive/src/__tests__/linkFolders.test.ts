/**
 * Folder links (#321), client side: who a file's key is sealed to, and that a guest's requests
 * carry the guest session and never the visitor's own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
      super(message);
    }
  },
  BASE_URL: '',
  buildQuery: () => '',
  contentVersionQuery: () => '',
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  generateFileKey: () => new Uint8Array(32).fill(9),
  // Seals record who they were sealed to, so the assertions can read it back.
  encryptFileKey: (_dek: Uint8Array, pk: Uint8Array) => `sealed-to:${new TextDecoder().decode(pk)}`,
  encryptMetadata: (meta: Record<string, unknown>) => `enc(${JSON.stringify(meta)})`,
  encryptFile: (plain: Uint8Array) => plain,
  fromBase64url: (s: string) => new TextEncoder().encode(s),
  linkPublicKey: async (seed: string) => `pk-of-${seed}`,
  openSealedFileKey: () => new Uint8Array(32).fill(4),
  loadKeyPairForVersion: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
  loadKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
}));

vi.mock('@neutrino/utils', () => ({
  measurePhase: <T,>(_n: string, fn: () => Promise<T>) => fn(),
  measurePhaseSync: <T,>(_n: string, fn: () => T) => fn(),
}));

import { request } from '@neutrino/api-core';
import { linkFolderApi, linkKeyMatches, sealFolderLinkKeys, uploadToLinkFolder } from '../linkFolders';
import type { LinkSession } from '../linkFolders';

const mockRequest = vi.mocked(request);

const session: LinkSession = {
  seed: 'SEED',
  session: {
    accessToken: 'guest-jwt',
    expiresIn: 3600,
    role: 'editor',
    resourceType: 'folder',
    resourceId: 'root',
    resourceName: 'Shared',
    keySubject: 'guest:link-1',
    publicKey: 'pk-of-SEED',
  },
};

type Call = [string, RequestInit | undefined, Record<string, unknown> | undefined];
const calls = () => mockRequest.mock.calls as unknown as Call[];
const bodyOf = (c: Call) => JSON.parse(String(c[1]?.body ?? '{}'));

beforeEach(() => {
  mockRequest.mockReset();
});

describe('guest requests', () => {
  it('carry the guest bearer and opt out of the stored session', async () => {
    mockRequest.mockResolvedValueOnce({ folders: [], files: [], rootFolderId: 'root', role: 'editor' });
    await linkFolderApi.contents(session, 'root');
    const [path, init, config] = calls()[0];
    expect(path).toBe('/api/v1/share/folder/root');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer guest-jwt');
    expect(config).toMatchObject({ auth: 'none' });
  });

  it('checks the URL key against the link', async () => {
    expect(await linkKeyMatches(session)).toBe(true);
    expect(await linkKeyMatches({ ...session, seed: 'OTHER' })).toBe(false);
    expect(await linkKeyMatches({ ...session, session: { ...session.session, publicKey: null } })).toBe(false);
  });
});

describe('uploadToLinkFolder', () => {
  it('seals the upload to the owner, then to this link and any other link over the folder', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path.endsWith('/key-recipients')) {
        return {
          recipients: [
            { recipientId: 'owner-1', kind: 'owner', publicKey: 'OWNERPK', keyVersion: 3 },
            { recipientId: 'guest:outer', kind: 'link', publicKey: 'OUTERPK', keyVersion: 1 },
          ],
        };
      }
      if (path === '/api/v1/share/folder/upload') return { id: 'new-file' };
      return {};
    });

    await uploadToLinkFolder(session, 'sub', new File(['hi'], 'a.txt', { type: 'text/plain' }));

    const upload = calls().find((c) => c[0] === '/api/v1/share/folder/upload')!;
    const form = upload[1]!.body as FormData;
    expect(form.get('folder_id')).toBe('sub');
    expect(form.get('encrypted_file_key')).toBe('sealed-to:OWNERPK');
    expect(form.get('key_version')).toBe('3');

    const shares = calls().filter((c) => c[0] === '/api/v1/drive/files/new-file/key/share').map(bodyOf);
    expect(shares).toEqual([
      { recipientId: 'guest:link-1', encryptedFileKey: 'sealed-to:pk-of-SEED', keyVersion: 1 },
      { recipientId: 'guest:outer', encryptedFileKey: 'sealed-to:OUTERPK', keyVersion: 1 },
    ]);
  });

  it('refuses before uploading when the owner has no key to seal to', async () => {
    mockRequest.mockResolvedValueOnce({ recipients: [] });
    await expect(uploadToLinkFolder(session, 'sub', new File(['x'], 'x.txt'))).rejects.toThrow(
      /owner has not set up encryption/,
    );
    expect(calls().some((c) => c[0] === '/api/v1/share/folder/upload')).toBe(false);
  });
});

describe('sealFolderLinkKeys', () => {
  it('seals each unkeyed file to the link and counts what it could not open', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path.endsWith('/unkeyed-files')) {
        return { keySubject: 'guest:link-1', publicKey: 'LINKPK', fileIds: ['f1', 'f2'], hasMore: false };
      }
      if (path === '/api/v1/drive/files/f1/key') return { fileId: 'f1', userId: 'u', encryptedFileKey: 'x', keyVersion: 1 };
      if (path === '/api/v1/drive/files/f2/key') {
        const { ApiClientError } = await import('@neutrino/api-core');
        throw new ApiClientError(404, 'NOT_FOUND', 'no key');
      }
      return {};
    });

    const result = await sealFolderLinkKeys('u', 'root');
    expect(result).toEqual({ sealed: 1, skipped: 1 });
    const share = calls().find((c) => c[0] === '/api/v1/drive/files/f1/key/share')!;
    expect(bodyOf(share)).toEqual({
      recipientId: 'guest:link-1',
      encryptedFileKey: 'sealed-to:LINKPK',
      keyVersion: 1,
    });
  });

  it('stops when a page makes no progress instead of looping', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path.endsWith('/unkeyed-files')) {
        return { keySubject: 'guest:l', publicKey: 'PK', fileIds: ['stuck'], hasMore: true };
      }
      return null;
    });
    const result = await sealFolderLinkKeys('u', 'root');
    expect(result.skipped).toBe(1);
  });
});
