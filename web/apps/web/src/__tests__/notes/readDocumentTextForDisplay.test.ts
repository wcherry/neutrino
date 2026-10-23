/**
 * `readDocumentTextForDisplay` — what a grid card shows of a note.
 *
 * The indexer's reader treats "no key pair" as "not encrypted" and returns the
 * stored bytes as text, which on a card would be ciphertext. This one must
 * return the body, or `null`, and never the bytes of an encrypted file it
 * could not open.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getFileKey = vi.fn();
const openFileKey = vi.fn();
const downloadFile = vi.fn();
const loadKeyPair = vi.fn();
const decryptFile = vi.fn();

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(async () => {}),
  loadKeyPair: (...a: unknown[]) => loadKeyPair(...a),
  decryptFile: (...a: unknown[]) => decryptFile(...a),
  fromBase64url: (s: string) => new TextEncoder().encode(s),
}));

vi.mock('@/lib/api', () => ({
  encryptionApi: { getFileKey: (...a: unknown[]) => getFileKey(...a) },
  openFileKey: (...a: unknown[]) => openFileKey(...a),
  storageApi: { downloadFile: (...a: unknown[]) => downloadFile(...a) },
}));

vi.mock('@/lib/ooxmlContainer', () => ({
  looksLikeOoxml: () => false,
  readNeutrinoModel: vi.fn(),
}));

import { readDocumentTextForDisplay } from '@/lib/documentContent';

const CIPHERTEXT = 'c2VjcmV0LWNpcGhlcnRleHQ';

function stored(text: string) {
  return { arrayBuffer: async () => new TextEncoder().encode(text).buffer };
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadFile.mockResolvedValue(stored(CIPHERTEXT));
});

describe('readDocumentTextForDisplay', () => {
  it('returns an unencrypted body as it is stored', async () => {
    getFileKey.mockResolvedValue(null);
    downloadFile.mockResolvedValue(stored('# Plain note'));
    await expect(readDocumentTextForDisplay('u1', 'f1')).resolves.toBe('# Plain note');
  });

  it('decrypts an encrypted body when the session holds a key pair', async () => {
    getFileKey.mockResolvedValue({ encryptedFileKey: 'k' });
    loadKeyPair.mockReturnValue({ publicKey: 'pk' });
    openFileKey.mockResolvedValue(new Uint8Array([1]));
    decryptFile.mockReturnValue(new TextEncoder().encode('Milk and eggs'));
    await expect(readDocumentTextForDisplay('u1', 'f1')).resolves.toBe('Milk and eggs');
  });

  it('returns null, without downloading, for an encrypted note in a locked session', async () => {
    getFileKey.mockResolvedValue({ encryptedFileKey: 'k' });
    loadKeyPair.mockReturnValue(null);
    await expect(readDocumentTextForDisplay('u1', 'f1')).resolves.toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('returns null rather than ciphertext when the key will not open it', async () => {
    getFileKey.mockResolvedValue({ encryptedFileKey: 'k' });
    loadKeyPair.mockReturnValue({ publicKey: 'pk' });
    openFileKey.mockRejectedValue(new Error('bad key'));
    await expect(readDocumentTextForDisplay('u1', 'f1')).resolves.toBeNull();
  });
});
