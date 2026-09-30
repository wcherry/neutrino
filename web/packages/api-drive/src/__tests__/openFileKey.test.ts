/**
 * `openFileKey` re-files a key ref whose version turned out to be wrong.
 *
 * The iOS apps that unlocked from the key vault recorded their uploads as v1
 * whatever key they were sealed to. `openSealedFileKey` finds the right key and
 * says which; this is the half that writes that back, so the next reader on any
 * client goes straight to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {},
  BASE_URL: '',
  buildQuery: () => '',
  contentVersionQuery: () => '',
}));

/** The version the mocked keyring says actually opened the seal. */
let openedWith: number | null = null;

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  openSealedFileKey: (
    _userId: string,
    _sealed: string,
    _version: number,
    onMisfiled?: (v: number) => void,
  ) => {
    if (openedWith !== null) onMisfiled?.(openedWith);
    return new Uint8Array(32).fill(4);
  },
}));

import { request } from '@neutrino/api-core';
import { openFileKey } from '../client';

const mockRequest = vi.mocked(request);
const ref = { fileId: 'f', userId: 'u', encryptedFileKey: 'sealed', keyVersion: 1 };

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
  openedWith = null;
});

describe('openFileKey', () => {
  it('leaves a correctly filed ref alone', async () => {
    await openFileKey('u', 'file-ok', ref);

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('re-files a misfiled ref under the version that opened it, same sealed bytes', async () => {
    openedWith = 2;

    const dek = await openFileKey('u', 'file-misfiled', ref);

    expect(dek).toEqual(new Uint8Array(32).fill(4));
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/drive/files/file-misfiled/key', {
      method: 'PUT',
      body: JSON.stringify({ encryptedFileKey: 'sealed', keyVersion: 2 }),
    });
  });

  it('sends the correction once per file, however often the file is opened', async () => {
    openedWith = 2;

    await openFileKey('u', 'file-often', ref);
    await openFileKey('u', 'file-often', ref);

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('does not fail the read when the correction fails, and tries again next time', async () => {
    openedWith = 2;
    mockRequest.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(openFileKey('u', 'file-flaky', ref)).resolves.toBeInstanceOf(Uint8Array);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    await openFileKey('u', 'file-flaky', ref);

    expect(mockRequest).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
