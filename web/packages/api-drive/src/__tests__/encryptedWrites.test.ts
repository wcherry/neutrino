/**
 * Unit tests for `encryptedWrites.ts` — the module that replaced every
 * plaintext write to Drive (issue #95).
 *
 * The property under test is one sentence: **no key, no write.** Every branch
 * that used to end in "…else write it in the clear" now ends in a
 * `MissingEncryptionKeyError`, and the assertions below are mostly about what
 * did *not* happen — no upload, no autosave, no version snapshot — because
 * that is the failure mode the issue describes. A file that reaches Drive
 * unencrypted has no `file_key_refs` row, so no later pass can find it and fix
 * it; the write not happening is the whole point.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the transport and the crypto, so the tests assert on call shape
// rather than on real libsodium output.
// ---------------------------------------------------------------------------

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

/** null stands for a locked session — the state that must refuse to write. */
let keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;
let activeVersion: number | null = 3;

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => keyPair,
  activeKeyVersion: () => activeVersion,
  generateFileKey: () => new Uint8Array(32).fill(9),
  encryptFileKey: () => 'sealed-dek',
  encryptMetadata: (meta: Record<string, unknown>) => `enc(${JSON.stringify(meta)})`,
  openSealedFileKey: () => new Uint8Array(32).fill(4),
  encryptFile: (plain: Uint8Array) => plain,
}));

const generateThumbnail = vi.fn();
vi.mock('@neutrino/utils', () => ({
  generateThumbnail: (...a: unknown[]) => generateThumbnail(...a),
  // The phase marks are instrumentation, not behaviour: the stand-in runs the
  // work and reports nothing, so these tests keep asserting on what the code
  // does rather than on how it is measured.
  measurePhase: <T,>(_name: string, fn: () => Promise<T>) => fn(),
  measurePhaseSync: <T,>(_name: string, fn: () => T) => fn(),
}));

import { request } from '@neutrino/api-core';
import {
  MissingEncryptionKeyError,
  isMissingEncryptionKey,
  canEncryptFor,
  mintFileKey,
  requireFileKey,
  uploadDriveFile,
  autosaveEncrypted,
  createEncryptedVersion,
} from '../encryptedWrites';

const mockRequest = vi.mocked(request);

/** Every path a write could take out of this module. */
const writeEndpoints = () =>
  mockRequest.mock.calls
    .map(([path]) => path as string)
    .filter((p) => /upload|autosave|versions/.test(p));

beforeEach(() => {
  vi.clearAllMocks();
  keyPair = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) };
  activeVersion = 3;
  generateThumbnail.mockResolvedValue('thumb-b64');
  mockRequest.mockResolvedValue({ id: 'file-1' });
});

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

describe('no key, no write', () => {
  it.each([
    ['uploadDriveFile', () => uploadDriveFile(new File(['x'], 'a.png', { type: 'image/png' }), 'user-1')],
    ['mintFileKey', () => mintFileKey('user-1', 'file-1')],
    ['requireFileKey', () => requireFileKey('user-1', 'file-1')],
    ['autosaveEncrypted', () => autosaveEncrypted('file-1', '{}', 'note.json', 'user-1')],
    ['createEncryptedVersion', () => createEncryptedVersion('file-1', '{}', 'note.json', 'user-1')],
  ])('%s throws on a locked session and writes nothing', async (_name, call) => {
    keyPair = null;

    await expect(call()).rejects.toBeInstanceOf(MissingEncryptionKeyError);
    expect(writeEndpoints()).toEqual([]);
  });

  it.each([
    ['uploadDriveFile', () => uploadDriveFile(new File(['x'], 'a.png', { type: 'image/png' }), undefined)],
    ['mintFileKey', () => mintFileKey(undefined, 'file-1')],
    ['autosaveEncrypted', () => autosaveEncrypted('file-1', '{}', 'note.json', undefined)],
  ])('%s throws when there is no user id and writes nothing', async (_name, call) => {
    // A hook that has not resolved yet reads as `undefined`, and treating that
    // as "unencrypted is fine" is how the Takeout import used to write
    // thousands of plaintext files in one run.
    await expect(call()).rejects.toBeInstanceOf(MissingEncryptionKeyError);
    expect(writeEndpoints()).toEqual([]);
  });

  it('carries the `no-dek` message the editors already match on', () => {
    // DocEditor, SlideEditor and usePersistence all test `err.message ===
    // 'no-dek'` to raise ENCRYPTION_WARNING_MESSAGE. Changing this string
    // silently downgrades those to a generic save failure.
    expect(new MissingEncryptionKeyError().message).toBe('no-dek');
    expect(isMissingEncryptionKey(new MissingEncryptionKeyError())).toBe(true);
    // Editors that throw the bare sentinel themselves are recognised too.
    expect(isMissingEncryptionKey(new Error('no-dek'))).toBe(true);
    expect(isMissingEncryptionKey(new Error('network'))).toBe(false);
  });

  it('canEncryptFor answers without throwing, either way', async () => {
    await expect(canEncryptFor('user-1')).resolves.toBe(true);
    keyPair = null;
    await expect(canEncryptFor('user-1')).resolves.toBe(false);
    await expect(canEncryptFor(undefined)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// uploadDriveFile
// ---------------------------------------------------------------------------

describe('uploadDriveFile', () => {
  it('uploads ciphertext with a sealed key, encrypted metadata and a thumbnail', async () => {
    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });

    await uploadDriveFile(file, 'user-1', { folderId: 'folder-9' });

    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/upload');
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('folder_id')).toBe('folder-9');
    // Not the plaintext name: the server only ever sees ciphertext plus this.
    expect(fd.get('encrypted_metadata')).toBe(
      'enc({"name":"holiday.png","mimeType":"image/png"})',
    );
    expect(fd.get('mime_type')).toBe('image/png');
    // The server holds ciphertext and cannot make a preview of it, so a Drive
    // file without a client-made thumbnail is a blank tile in the grid.
    expect(fd.get('thumbnail_b64')).toBe('thumb-b64');
    expect((fd.get('file') as File).type).toBe('application/octet-stream');
  });

  it('registers the sealed DEK against the uploaded file', async () => {
    mockRequest.mockResolvedValueOnce({ id: 'file-7' });

    await uploadDriveFile(new File(['b'], 'a.bin'), 'user-1');

    const keyCall = mockRequest.mock.calls.find(([p]) => String(p).endsWith('/key'));
    expect(keyCall).toBeDefined();
    expect(String(keyCall![0])).toBe('/api/v1/drive/files/file-7/key');
    expect(JSON.parse((keyCall![1] as RequestInit).body as string)).toMatchObject({
      encryptedFileKey: 'sealed-dek',
      keyVersion: 3,
    });
  });

  it('skips the thumbnail for a non-image', async () => {
    await uploadDriveFile(new File(['b'], 'notes.pdf', { type: 'application/pdf' }), 'user-1');

    const fd = (mockRequest.mock.calls[0][1] as RequestInit).body as FormData;
    expect(fd.get('thumbnail_b64')).toBeNull();
    expect(generateThumbnail).not.toHaveBeenCalled();
  });

  it('uploads anyway when the thumbnail cannot be made', async () => {
    // A blank tile is a cosmetic problem. Failing the upload over it would
    // make an unrelated canvas error look like a lost file.
    generateThumbnail.mockRejectedValueOnce(new Error('canvas unavailable'));

    await expect(
      uploadDriveFile(new File(['b'], 'a.png', { type: 'image/png' }), 'user-1'),
    ).resolves.toBeDefined();
    expect(writeEndpoints()).toContain('/api/v1/drive/files/upload');
  });

  it('honours an explicit null thumbnail without generating one', async () => {
    await uploadDriveFile(new File(['b'], 'a.png', { type: 'image/png' }), 'user-1', {
      thumbnailB64: null,
    });

    expect(generateThumbnail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

describe('requireFileKey', () => {
  it('opens the registered key when the file already has one', async () => {
    mockRequest.mockResolvedValueOnce({ encryptedFileKey: 'sealed', keyVersion: 2 });

    const { dek, isNew } = await requireFileKey('user-1', 'file-1');

    expect(isNew).toBe(false);
    expect(dek).toEqual(new Uint8Array(32).fill(4));
    // Reading a key is not a write, and nothing new was registered.
    expect(mockRequest.mock.calls.filter(([, init]) =>
      (init as RequestInit | undefined)?.method === 'PUT')).toEqual([]);
  });

  it('mints and registers one when the file has none', async () => {
    // 404 from the key endpoint is "unencrypted file", not an error.
    const { ApiClientError } = await import('@neutrino/api-core');
    mockRequest.mockRejectedValueOnce(new (ApiClientError as never as new (
      s: number, c: string, m: string,
    ) => Error)(404, 'not_found', 'no key'));

    const { dek, isNew } = await requireFileKey('user-1', 'file-1');

    expect(isNew).toBe(true);
    expect(dek).toEqual(new Uint8Array(32).fill(9));
    const keyPut = mockRequest.mock.calls.find(
      ([p, init]) => String(p).endsWith('/key')
        && (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(keyPut).toBeDefined();
  });

  it('resolves the keypair before asking the server for anything', async () => {
    // Otherwise a locked session costs a round trip before failing, on every
    // autosave tick, for as long as the vault stays locked.
    keyPair = null;

    await expect(requireFileKey('user-1', 'file-1')).rejects.toBeInstanceOf(
      MissingEncryptionKeyError,
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Content writes
// ---------------------------------------------------------------------------

describe('content writes', () => {
  it('autosaveEncrypted writes ciphertext to the autosave endpoint', async () => {
    await autosaveEncrypted('file-1', '{"a":1}', 'note.json', 'user-1', {
      dek: new Uint8Array(32).fill(5),
    });

    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/autosave');
    expect((init as RequestInit).method).toBe('PUT');
    // Never `application/json`: that is what the removed plaintext helper used,
    // and it is the tell for a body the server could read.
    const fd = (init as RequestInit).body as FormData;
    expect((fd.get('file') as Blob).type).toBe('application/octet-stream');
  });

  it('createEncryptedVersion writes ciphertext to the versions endpoint', async () => {
    await createEncryptedVersion('file-1', '{"a":1}', 'note.json', 'user-1', {
      dek: new Uint8Array(32).fill(5),
      label: 'Snapshot',
    });

    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/versions');
    expect((init as RequestInit).method).toBe('POST');
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('label')).toBe('Snapshot');
    expect((fd.get('file') as Blob).type).toBe('application/octet-stream');
  });

  it('resolves the file key itself when the caller has none in hand', async () => {
    mockRequest.mockResolvedValueOnce({ encryptedFileKey: 'sealed', keyVersion: 1 });

    await autosaveEncrypted('file-1', '{}', 'note.json', 'user-1');

    expect(String(mockRequest.mock.calls[0][0])).toBe('/api/v1/drive/files/file-1/key');
    expect(String(mockRequest.mock.calls[1][0])).toBe('/api/v1/drive/files/file-1/autosave');
  });
});
